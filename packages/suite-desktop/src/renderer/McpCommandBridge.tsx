// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import React, { useEffect } from "react";

import { Time, clampTime, compare, fromSec, toSec } from "@lichtblick/rostime";
import {
  MessagePipelineContext,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  LayoutID,
  useCurrentLayoutActions,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import type { ILayoutManager } from "@lichtblick/suite-base/services/ILayoutManager";
import { MAX_SUPPORTED_LAYOUT_VERSION } from "@lichtblick/suite-base/providers/CurrentLayoutProvider/constants";
import { validateLayoutData } from "@lichtblick/suite-base/util/layout";

import { Desktop } from "../common/types";

const NO_PLAYBACK_SUPPORT = "data source does not support playback control";
const DEFAULT_STEP_SEC = 0.1;

/** Serializes a Time both as the {sec, nsec} structure and as seconds. */
function timePayload(time: Time | undefined): { sec: number; nsec: number; seconds: number } | undefined {
  return time == undefined ? undefined : { sec: time.sec, nsec: time.nsec, seconds: toSec(time) };
}

/** Mirrors the PanelExtensionAdapter seekPlayback contract: numbers go through fromSec. */
function toTime(time: number | { sec: number; nsec: number }): Time {
  return typeof time === "object" ? { sec: time.sec, nsec: time.nsec } : fromSec(time);
}

/**
 * Executes `"playback.*"` commands against the given message pipeline context. Throws on
 * unsupported playback control; the caller turns a thrown error into an `{ok: false}` reply.
 */
export function executePlaybackCommand(
  msg: { type: string; payload: unknown },
  ctx: MessagePipelineContext,
): unknown {
  const activeData = ctx.playerState.activeData;

  switch (msg.type) {
    case "playback.get_state":
      return {
        currentTime: timePayload(activeData?.currentTime),
        startTime: timePayload(activeData?.startTime),
        endTime: timePayload(activeData?.endTime),
        isPlaying: activeData?.isPlaying,
        speed: activeData?.speed,
        presence: ctx.playerState.presence,
        playbackControlAvailable: ctx.seekPlayback != undefined,
      };

    case "playback.set_time": {
      const seek = ctx.seekPlayback;
      if (activeData == undefined || seek == undefined) {
        throw new Error(NO_PLAYBACK_SUPPORT);
      }
      const target = clampTime(
        toTime((msg.payload as { time: number | { sec: number; nsec: number } }).time),
        activeData.startTime,
        activeData.endTime,
      );
      seek(target);
      return { time: timePayload(target) };
    }

    case "playback.play": {
      const play = ctx.startPlayback;
      if (play == undefined) {
        throw new Error(NO_PLAYBACK_SUPPORT);
      }
      // If we are at the end, we need to go back to start (mirrors PlaybackControls).
      const { currentTime, startTime, endTime } = activeData ?? {};
      const seek = ctx.seekPlayback;
      let seekedToStart = false;
      if (
        seek != undefined &&
        currentTime != undefined &&
        startTime != undefined &&
        endTime != undefined &&
        compare(currentTime, endTime) >= 0
      ) {
        seek(startTime);
        seekedToStart = true;
      }
      play();
      return { action: "play", seekedToStart };
    }

    case "playback.pause": {
      const pause = ctx.pausePlayback;
      if (pause == undefined) {
        throw new Error(NO_PLAYBACK_SUPPORT);
      }
      pause();
      return { action: "pause" };
    }

    case "playback.step": {
      const seek = ctx.seekPlayback;
      if (activeData == undefined || seek == undefined) {
        throw new Error(NO_PLAYBACK_SUPPORT);
      }
      const { direction, seconds } = msg.payload as { direction: "forward" | "backward"; seconds?: number };
      const delta = (seconds ?? DEFAULT_STEP_SEC) * (direction === "forward" ? 1 : -1);
      const target = fromSec(toSec(activeData.currentTime) + delta);
      // Playing forward up to the target plays all messages to the panels, which matters for
      // message types that convey state (mirrors useDirectionalSeek). Backward always seeks.
      if (direction === "forward" && ctx.playUntil != undefined) {
        ctx.playUntil(target);
        return { steppedTo: timePayload(target), via: "playUntil" };
      }
      seek(target);
      return { steppedTo: timePayload(target), via: "seek" };
    }

    default:
      throw new Error(`unknown playback command: ${msg.type}`);
  }
}

/** Collaborators needed to execute `"layout.*"` commands (all reachable from the pipelineAdapters slot). */
export type LayoutCommandDeps = {
  layoutManager: Pick<ILayoutManager, "getLayouts" | "saveNewLayout">;
  setSelectedLayoutId: (id: LayoutID) => void | Promise<void>;
};

function assertSupportedVersion(version: number | undefined): void {
  if (version != undefined && version > MAX_SUPPORTED_LAYOUT_VERSION) {
    throw new Error(
      `layout version ${version} is not supported (maximum supported layout version is ${MAX_SUPPORTED_LAYOUT_VERSION})`,
    );
  }
}

/**
 * Executes `"layout.*"` commands against the layout manager / current layout. Mirrors the flows the
 * workspace UI already uses: getLayouts for listings, setSelectedLayoutId for selection, and the
 * useLayoutTransfer parseAndInstallLayout flow (validate → saveNewLayout → select) for installs.
 * Throws on invalid input; the caller turns a thrown error into an `{ok: false}` reply.
 */
export async function executeLayoutCommand(
  msg: { type: string; payload: unknown },
  deps: LayoutCommandDeps,
): Promise<unknown> {
  switch (msg.type) {
    case "layout.list_layouts": {
      const layouts = await deps.layoutManager.getLayouts();
      return {
        layouts: layouts.map((layout) => ({
          id: layout.id,
          name: layout.name,
          updatedAt: layout.working?.savedAt ?? layout.baseline.savedAt,
        })),
      };
    }

    case "layout.get_layout": {
      const { name } = msg.payload as { name: string };
      const layout = (await deps.layoutManager.getLayouts()).find((l) => l.name === name);
      if (layout == undefined) {
        throw new Error(`layout not found: ${name}`);
      }
      return layout.working?.data ?? layout.baseline.data;
    }

    case "layout.load_layout": {
      const { name, layout_json } = msg.payload as { name?: string; layout_json?: unknown };
      if ((name == undefined) === (layout_json == undefined)) {
        throw new Error("provide exactly one of name or layout_json");
      }
      if (layout_json != undefined) {
        // parseAndInstallLayout-equivalent flow: parse (if a string) → validate → save → select.
        const parsedState: unknown =
          typeof layout_json === "string" ? JSON.parse(layout_json) : layout_json;
        const data = validateLayoutData(parsedState);
        assertSupportedVersion(data.version);
        const newLayout = await deps.layoutManager.saveNewLayout({
          name: `imported-layout-${new Date().toISOString()}`,
          data,
          permission: "CREATOR_WRITE",
        });
        await deps.setSelectedLayoutId(newLayout.id);
        return { id: newLayout.id, name: newLayout.name };
      }
      const layout = (await deps.layoutManager.getLayouts()).find((l) => l.name === name);
      if (layout == undefined) {
        throw new Error(`layout not found: ${name!}`);
      }
      assertSupportedVersion((layout.working?.data ?? layout.baseline.data).version);
      await deps.setSelectedLayoutId(layout.id);
      return { id: layout.id, name: layout.name };
    }

    default:
      throw new Error(`unknown layout command: ${msg.type}`);
  }
}

/** Routes a main-process MCP command to its executor. Task 6+ appends further branches here. */
export function executeMcpCommand(
  msg: { type: string; payload: unknown },
  ctx: MessagePipelineContext,
  layoutDeps: LayoutCommandDeps,
): unknown {
  if (msg.type.startsWith("playback.")) {
    return executePlaybackCommand(msg, ctx);
  }
  if (msg.type.startsWith("layout.")) {
    return executeLayoutCommand(msg, layoutDeps);
  }
  throw new Error(`unknown mcp command: ${msg.type}`);
}

/**
 * McpCommandBridge executes MCP commands sent from the main process against the message pipeline
 * and replies with `{ok: true, value}` or `{ok: false, error}` via sendMcpResult. Headless sibling
 * of McpStateBridge; rendered inside the message pipeline context via the pipelineAdapters slot.
 */
export default function McpCommandBridge(): React.JSX.Element | null {
  const desktopBridge = (global as unknown as { desktopBridge?: Desktop }).desktopBridge;
  const getMessagePipeline = useMessagePipelineGetter();
  // Rendered inside MultiProvider next to LayoutManagerProvider/CurrentLayoutProvider (App's
  // pipelineAdapters slot), so both contexts are reachable here.
  const layoutManager = useLayoutManager();
  const { setSelectedLayoutId } = useCurrentLayoutActions();

  useEffect(() => {
    if (desktopBridge == undefined) {
      return;
    }
    let disposed = false;
    const unregister = desktopBridge.onMcpCommand((msg) => {
      void (async () => {
        let reply: { ok: boolean; value?: unknown; error?: string };
        try {
          reply = {
            ok: true,
            value: await executeMcpCommand(msg, getMessagePipeline(), { layoutManager, setSelectedLayoutId }),
          };
        } catch (err) {
          reply = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        if (!disposed) {
          desktopBridge.sendMcpResult(msg.id, reply);
        }
      })();
    });
    return () => {
      disposed = true;
      unregister();
    };
  }, [desktopBridge, getMessagePipeline, layoutManager, setSelectedLayoutId]);

  if (desktopBridge == undefined) {
    return null;
  }
  return <></>;
}

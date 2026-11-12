// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import React, { useEffect, useRef } from "react";

import { Time, clampTime, compare, fromSec, toSec } from "@lichtblick/rostime";
import {
  MessagePipelineContext,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/src/components/MessagePipeline";
import {
  LayoutID,
  useCurrentLayoutActions,
} from "@lichtblick/suite-base/src/context/CurrentLayoutContext";
import { useLayoutManager } from "@lichtblick/suite-base/src/context/LayoutManagerContext";
import { useUserScriptState } from "@lichtblick/suite-base/src/context/UserScriptStateContext";
import { DIAGNOSTIC_SEVERITY } from "@lichtblick/suite-base/src/players/UserScriptPlayer/constants";
import type {
  Diagnostic,
  UserScriptLog,
} from "@lichtblick/suite-base/src/players/UserScriptPlayer/types";
import type { MessageEvent, Topic } from "@lichtblick/suite-base/src/players/types";
import { MAX_SUPPORTED_LAYOUT_VERSION } from "@lichtblick/suite-base/src/providers/CurrentLayoutProvider/constants";
import type { ILayoutManager } from "@lichtblick/suite-base/src/services/ILayoutManager";
import type { UserScript, UserScripts } from "@lichtblick/suite-base/src/types/panels";
import { validateLayoutData } from "@lichtblick/suite-base/src/util/layout";

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

/**
 * Collaborators needed to execute `"script.*"` commands against the current layout's user scripts.
 * Reads go through a getter (layout state changes often; the handler wants the freshest snapshot
 * without re-registering on every change), writes through setUserScripts, whose reducer merges by
 * key and deletes on undefined values.
 */
export type ScriptCommandDeps = {
  getUserScripts: () => UserScripts;
  setUserScripts: (payload: Partial<UserScripts>) => void;
};

/** Allocates `mcp-script-<n>` with n = 1 + the max numeric suffix (cannot collide with panel ids). */
function nextMcpScriptId(userScripts: UserScripts): string {
  let max = 0;
  for (const key of Object.keys(userScripts)) {
    const match = /^mcp-script-(\d+)$/.exec(key);
    if (match != undefined) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `mcp-script-${max + 1}`;
}

/**
 * Executes `"script.*"` commands against the current layout's user scripts via setUserScripts.
 * Miss detection happens before dispatching so a delete of a nonexistent id never silently
 * succeeds. Throws on invalid input; the caller turns a thrown error into an `{ok: false}` reply.
 */
export function executeScriptCommand(
  msg: { type: string; payload: unknown },
  deps: ScriptCommandDeps,
): unknown {
  const userScripts = deps.getUserScripts();

  switch (msg.type) {
    case "script.list":
      return {
        scripts: Object.entries(userScripts).map(([id, script]) => ({ id, name: script.name })),
      };

    case "script.get": {
      const { id } = msg.payload as { id?: string };
      const script = id != undefined ? userScripts[id] : undefined;
      if (script == undefined) {
        throw new Error(`user script not found: ${id}`);
      }
      return { name: script.name, sourceCode: script.sourceCode };
    }

    case "script.put": {
      const { name, sourceCode, id } = msg.payload as {
        name?: unknown;
        sourceCode?: unknown;
        id?: string;
      };
      if (typeof name !== "string" || name.length === 0) {
        throw new Error("name must be a non-empty string");
      }
      if (typeof sourceCode !== "string" || sourceCode.length === 0) {
        throw new Error("sourceCode must be a non-empty string");
      }
      const scriptId = id ?? nextMcpScriptId(userScripts);
      const created = userScripts[scriptId] == undefined;
      deps.setUserScripts({ [scriptId]: { name, sourceCode } });
      return { id: scriptId, name, created };
    }

    case "script.delete": {
      const { id } = msg.payload as { id?: string };
      // The reducer would silently ignore (or drop) a miss, so detect it before dispatching.
      if (id == undefined || userScripts[id] == undefined) {
        throw new Error(`user script not found: ${id}`);
      }
      deps.setUserScripts({ [id]: undefined });
      return { id, deleted: true };
    }

    default:
      throw new Error(`unknown script command: ${msg.type}`);
  }
}

const RUN_SCRIPT_ID = "mcp-run-script";
const RUN_SCRIPT_NAME = "mcp script run";
const SCRIPT_RUN_BUSY = "a script run is already in progress";
const LIVE_BATCH_ERROR = "live data sources do not support batch script runs";
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_POLL_TIMEOUT_MS = 10_000;

// ponytail: module-level lock — the run uses one fixed temp script id, so one run at a time;
// per-window locks only if windows ever need concurrent runs.
let scriptRunInFlight = false;

/** Diagnostics + logs the UserScriptPlayer writes for a script id during registration/runs. */
export type ScriptRunState = {
  diagnostics: readonly Diagnostic[];
  logs: readonly UserScriptLog[];
};

/**
 * Collaborators for `"script.run"`. getPipeline must return a FRESH pipeline read per call (the
 * poll loop watches playerState.topics change as the UserScriptPlayer re-registers the script);
 * getScriptState reads the UserScriptStateContext store the player writes logs/diagnostics into.
 */
export type ScriptRunCommandDeps = {
  getUserScripts: () => UserScripts;
  setUserScripts: (payload: Partial<UserScripts>) => void;
  getPipeline: () => Pick<MessagePipelineContext, "playerState" | "getBatchIterator">;
  getScriptState: (scriptId: string) => ScriptRunState | undefined;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serializes a script output message-event whole-but-JSON-safe (bigint payloads stringify). */
function serializeMessage(ev: MessageEvent): Record<string, unknown> {
  return {
    topic: ev.topic,
    schemaName: ev.schemaName,
    receiveTime: { sec: ev.receiveTime.sec, nsec: ev.receiveTime.nsec },
    publishTime:
      ev.publishTime == undefined
        ? undefined
        : { sec: ev.publishTime.sec, nsec: ev.publishTime.nsec },
    sizeInBytes: ev.sizeInBytes,
    message: ev.message,
  };
}

/**
 * Waits until exactly one topic that was not in the baseline player state appears — the script's
 * output topic (the UserScriptPlayer re-registers and emits new topics, index.ts:748-775). Fails
 * with a discriminating error on ambiguity, with the script's error diagnostics as soon as the
 * player reports them (compile errors never register a topic; only diagnostics written after run
 * start count — the player never clears stale ones), or with a timeout error naming
 * what was awaited. ponytail: baseline is captured once at run start — a source still loading
 * (no activeData yet) yields an empty baseline and the run fails ambiguous/timeout; callers run
 * against an already-loaded source.
 */
async function pollForOutputTopic(
  deps: ScriptRunCommandDeps,
  baseline: Set<string>,
  initialDiagnostics: readonly Diagnostic[] | undefined,
): Promise<{ outputTopic: Topic; schemaName?: string }> {
  const intervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = deps.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const topics = deps.getPipeline().playerState.activeData?.topics ?? [];
    const candidates = topics.filter((topic) => !baseline.has(topic.name));
    if (candidates.length === 1) {
      return { outputTopic: candidates[0]!, schemaName: candidates[0]!.schemaName };
    }
    if (candidates.length > 1) {
      throw new Error(
        `ambiguous script output topics: ${candidates.map((topic) => topic.name).join(", ")}`,
      );
    }
    // The player only clears diagnostics on successful registration (index.ts:749), so a failed
    // earlier run's Error diagnostics would otherwise poison every later run: only fail fast on
    // a diagnostics array that differs from the one at run start (the store always allocates a
    // fresh array on write, so identity is a reliable freshness signal).
    const diagnostics = deps.getScriptState(RUN_SCRIPT_ID)?.diagnostics;
    if (diagnostics != undefined && diagnostics !== initialDiagnostics) {
      const errorDiagnostics = diagnostics.filter(
        (diagnostic) => diagnostic.severity === DIAGNOSTIC_SEVERITY.Error,
      );
      if (errorDiagnostics.length > 0) {
        throw new Error(`script failed: ${errorDiagnostics.map((d) => d.message).join("; ")}`);
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for the script output topic to register in the player state`,
      );
    }
    await sleep(intervalMs);
  }
}

/**
 * Executes the `"script.run"` command: write a temp script under the fixed id `mcp-run-script`,
 * wait for its output topic to register in player state, batch-collect up to maxMessages output
 * messages through the pipeline's getBatchIterator (the UserScriptPlayer's virtual iterator needs
 * no panel subscriptions), read back logs/diagnostics, and restore the layout in a finally.
 * Live sources have no getBatchIterator and fail with an explicit error. One run at a time.
 */
export async function executeScriptRunCommand(
  msg: { type: string; payload: unknown },
  deps: ScriptRunCommandDeps,
): Promise<unknown> {
  const { sourceCode, name, maxMessages } = (msg.payload ?? {}) as {
    sourceCode?: unknown;
    name?: unknown;
    maxMessages?: unknown;
  };
  if (typeof sourceCode !== "string" || sourceCode.length === 0) {
    throw new Error("sourceCode must be a non-empty string");
  }
  if (name != undefined && (typeof name !== "string" || name.length === 0)) {
    throw new Error("name must be a non-empty string when provided");
  }
  const limit = maxMessages ?? 100;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
    throw new Error("maxMessages must be a positive integer");
  }
  if (scriptRunInFlight) {
    throw new Error(SCRIPT_RUN_BUSY);
  }
  scriptRunInFlight = true;
  // Restore whatever occupied the reserved id before the run (undefined on a clean layout) so
  // the finally always returns the layout to its prior state. Declared out here so the finally
  // can decide whether the temp write ever happened (baseline stays undefined until after the
  // pre-write reads succeed), and captured inside the try so a throwing read still clears the
  // busy flag without attempting a restore.
  let previousScript: UserScript | undefined;
  let baseline: Set<string> | undefined;
  let initialDiagnostics: readonly Diagnostic[] | undefined;
  try {
    previousScript = deps.getUserScripts()[RUN_SCRIPT_ID];
    // Topics before the script exists — captured before the write so the script's own output
    // topic can never be part of the baseline.
    baseline = new Set(
      (deps.getPipeline().playerState.activeData?.topics ?? []).map((topic) => topic.name),
    );
    // Array identity at run start — pollForOutputTopic only fails fast on a *changed* array.
    initialDiagnostics = deps.getScriptState(RUN_SCRIPT_ID)?.diagnostics;

    deps.setUserScripts({ [RUN_SCRIPT_ID]: { name: name ?? RUN_SCRIPT_NAME, sourceCode } });

    const { outputTopic, schemaName } = await pollForOutputTopic(deps, baseline, initialDiagnostics);
    const iterator = deps.getPipeline().getBatchIterator(outputTopic.name);
    if (iterator == undefined) {
      throw new Error(LIVE_BATCH_ERROR);
    }

    const messages: unknown[] = [];
    for await (const result of iterator) {
      if (result.type !== "message-event") {
        continue; // stamps/alerts are not script output
      }
      messages.push(serializeMessage(result.msgEvent));
      if (messages.length >= limit) {
        break;
      }
    }

    const state = deps.getScriptState(RUN_SCRIPT_ID);
    const firstMessage = messages[0] as { schemaName?: string } | undefined;
    return {
      outputTopic: outputTopic.name,
      schemaName: schemaName ?? firstMessage?.schemaName,
      count: messages.length,
      messages,
      logs: (state?.logs ?? []).map((log) => ({ source: log.source, value: log.value })),
      diagnostics: state?.diagnostics ?? [],
    };
  } finally {
    // Clear the flag first: a throwing restore dispatch must not leak it (the residue self-heals
    // — the next run snapshots and restores whatever occupies the id).
    scriptRunInFlight = false;
    if (baseline != undefined) {
      deps.setUserScripts({ [RUN_SCRIPT_ID]: previousScript });
    }
  }
}

/** Routes a main-process MCP command to its executor. Task 6+ appends further branches here. */
export function executeMcpCommand(
  msg: { type: string; payload: unknown },
  ctx: MessagePipelineContext,
  layoutDeps: LayoutCommandDeps,
  scriptDeps: ScriptCommandDeps,
  scriptRunDeps: ScriptRunCommandDeps,
): unknown {
  if (msg.type.startsWith("playback.")) {
    return executePlaybackCommand(msg, ctx);
  }
  if (msg.type.startsWith("layout.")) {
    return executeLayoutCommand(msg, layoutDeps);
  }
  if (msg.type === "script.run") {
    return executeScriptRunCommand(msg, scriptRunDeps);
  }
  if (msg.type.startsWith("script.")) {
    return executeScriptCommand(msg, scriptDeps);
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
  // Rendered inside MultiProvider next to LayoutManagerProvider/CurrentLayoutProvider and below
  // UserScriptStateProvider (App's pipelineAdapters slot), so all three contexts are reachable.
  const layoutManager = useLayoutManager();
  const { setSelectedLayoutId, setUserScripts, getCurrentLayoutState } = useCurrentLayoutActions();
  // Script run logs/diagnostics: read through a ref so script-state churn never re-registers the
  // command handler (the effect below doesn't depend on it).
  const scriptStates = useUserScriptState((state) => state.state.scriptStates);
  const scriptStatesRef = useRef(scriptStates);
  scriptStatesRef.current = scriptStates;

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
            value: await executeMcpCommand(
              msg,
              getMessagePipeline(),
              { layoutManager, setSelectedLayoutId },
              {
                // Read scripts on demand from the current layout state (getCurrentLayoutState is the
                // documented snapshot getter for async callbacks; avoids re-rendering per change).
                getUserScripts: () => getCurrentLayoutState().selectedLayout?.data?.userNodes ?? {},
                setUserScripts,
              },
              {
                getUserScripts: () => getCurrentLayoutState().selectedLayout?.data?.userNodes ?? {},
                setUserScripts,
                // Fresh pipeline read per poll tick: playerState.topics changes as the
                // UserScriptPlayer re-registers the temp script.
                getPipeline: () => getMessagePipeline(),
                getScriptState: (scriptId) => scriptStatesRef.current[scriptId],
              },
            ),
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
  }, [
    desktopBridge,
    getMessagePipeline,
    layoutManager,
    setSelectedLayoutId,
    setUserScripts,
    getCurrentLayoutState,
  ]);

  if (desktopBridge == undefined) {
    return null;
  }
  return <></>;
}

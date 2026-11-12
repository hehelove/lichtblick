// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { z } from "zod";

import type { McpServer } from "../McpServer";

export type PlaybackToolDeps = {
  sendCommand: (type: string, payload: unknown) => Promise<unknown>;
};

const timeSchema = z
  .union([z.number(), z.object({ sec: z.number(), nsec: z.number() })])
  .describe("Target time as seconds (number) or as a {sec, nsec} structure");

function textResult(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text", text: JSON.stringify(value) ?? "" }] };
}

/**
 * Unwraps the renderer's bridge reply. The bridge protocol has no error channel, so the renderer
 * replies `{ ok: true, value }` or `{ ok: false, error }` and anything else is a renderer bug.
 */
function commandResult(reply: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  if (typeof reply !== "object" || reply == null) {
    return {
      content: [{ type: "text", text: `internal error: unexpected renderer reply` }],
      isError: true,
    };
  }
  const { ok, value, error } = reply as { ok?: unknown; value?: unknown; error?: unknown };
  if (ok === true) {
    return textResult(value);
  }
  if (ok === false) {
    const errorText =
      error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";
    return {
      content: [{ type: "text", text: errorText }],
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: `internal error: malformed renderer reply` }],
    isError: true,
  };
}

/**
 * Registers the playback control tools. Each tool forwards a `"playback.*"` command to the focused
 * window via the injected sendCommand (the mcp dispatch module) and unwraps the renderer's reply.
 * Pure: no electron imports — the collaborator is injected.
 */
export function registerPlaybackTools(
  mcp: Pick<McpServer, "registerTool">,
  deps: PlaybackToolDeps,
): void {
  async function run(type: string, payload: unknown) {
    try {
      return commandResult(await deps.sendCommand(type, payload));
    } catch (err) {
      // Dispatch failures (no window, timeout) are tool-level outcomes, not server failures.
      return {
        content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  }

  mcp.registerTool(
    "get_playback_state",
    {
      title: "Get playback state",
      description:
        "Get the playback state of the focused Studio window: current/start/end times (as {sec, nsec} and seconds), play/pause state, speed, presence, and whether playback control is available",
      annotations: { readOnlyHint: true },
    },
    async () => await run("playback.get_state", {}),
  );

  mcp.registerTool(
    "set_playback_time",
    {
      title: "Set playback time",
      description:
        "Seek playback in the focused Studio window to the given time (seconds or {sec, nsec}), clamped into the data source's [start, end] range",
      inputSchema: { time: timeSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ time }) => await run("playback.set_time", { time }),
  );

  mcp.registerTool(
    "play",
    {
      title: "Play",
      description:
        "Start playback in the focused Studio window; wraps back to the start when at the end",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async () => await run("playback.play", {}),
  );

  mcp.registerTool(
    "pause",
    {
      title: "Pause",
      description: "Pause playback in the focused Studio window",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async () => await run("playback.pause", {}),
  );

  mcp.registerTool(
    "step",
    {
      title: "Step playback",
      description:
        'Step playback in the focused Studio window "forward" or "backward" by a number of seconds (default 0.1). Stepping forward plays through messages up to the target when the data source supports it',
      inputSchema: {
        direction: z.enum(["forward", "backward"]).describe("Direction to step"),
        seconds: z.number().positive().optional().describe("Step size in seconds (default 0.1)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ direction, seconds }) => await run("playback.step", { direction, seconds }),
  );
}

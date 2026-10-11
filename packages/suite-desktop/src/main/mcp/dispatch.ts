// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { BrowserWindow, app, ipcMain, webContents } from "electron";

import Logger from "@lichtblick/log";
import { PlayerPresence } from "@lichtblick/suite-base/src/players/types";

import { McpStateSnapshot } from "../../common/types";

const log = Logger.getLogger(__filename);

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

const EMPTY_SNAPSHOT: McpStateSnapshot = {
  presence: PlayerPresence.NOT_PRESENT,
  playerName: undefined,
  topics: [],
  datatypes: {},
};

type PendingCommand = {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

// The window MCP commands and state snapshots are routed to. Until a focus event arrives this
// falls back to the first window, which matches the window commands target on a fresh launch.
let focusedWebContentsId: number | undefined;

// Latest snapshot pushed by the renderer, read by MCP tools via getMcpState().
let snapshot: McpStateSnapshot = EMPTY_SNAPSHOT;

let nextCommandId = 1;
const pendingCommands = new Map<number, PendingCommand>();

function targetWebContentsId(): number | undefined {
  return focusedWebContentsId ?? BrowserWindow.getAllWindows()[0]?.webContents.id;
}

app.on("browser-window-focus", (_ev, browserWindow) => {
  focusedWebContentsId = browserWindow.webContents.id;
});

ipcMain.on("mcp-state-snapshot", (ev, newSnapshot: McpStateSnapshot) => {
  if (ev.sender.id !== targetWebContentsId()) {
    return;
  }
  snapshot = newSnapshot;
});

ipcMain.handle("mcp-result", (_ev, id: number, result: unknown) => {
  const pending = pendingCommands.get(id);
  if (pending == undefined) {
    log.warn(`Received mcp-result for unknown command id ${id}`);
    return;
  }
  pendingCommands.delete(id);
  clearTimeout(pending.timer);
  pending.resolve(result);
});

/**
 * Sends a command to the focused renderer window over the `mcp-command` channel and returns the
 * value the renderer replies with over `mcp-result`. Rejects when there is no window to target or
 * when the renderer does not reply within `timeoutMs` (default 60s).
 */
export async function sendCommandToFocusedWindow(
  type: string,
  payload: unknown,
  opts?: { timeoutMs?: number },
): Promise<unknown> {
  const contentsId = targetWebContentsId();
  const contents = contentsId == undefined ? undefined : webContents.fromId(contentsId);
  if (contents == undefined) {
    throw new Error(`MCP command "${type}" failed: no window`);
  }

  const id = nextCommandId++;
  contents.send("mcp-command", { id, type, payload });

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(id);
      reject(new Error(`MCP command "${type}" timed out`));
    }, opts?.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
    pendingCommands.set(id, { resolve, reject, timer });
  });
}

/** Returns the latest state snapshot pushed by the focused renderer window. */
export function getMcpState(): McpStateSnapshot {
  return snapshot;
}

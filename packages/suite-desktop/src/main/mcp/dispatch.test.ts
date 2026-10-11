// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

jest.mock("@lichtblick/log", () => ({
  getLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

type IpcListener = (...args: unknown[]) => void;

const mockAppListeners = new Map<string, IpcListener[]>();
const mockIpcListeners = new Map<string, IpcListener[]>();
const mockIpcHandlers = new Map<string, IpcListener>();
const mockWebContentsById = new Map<number, { id: number; send: jest.Mock }>();
const mockAllWindows: Array<{ webContents: { id: number } }> = [];
const mockStudioWindowIds = new Set<number>();

jest.mock("../StudioWindow", () => ({
  __esModule: true,
  default: {
    fromWebContentsId: (id: number) => (mockStudioWindowIds.has(id) ? { id } : undefined),
  },
}));

jest.mock("electron", () => ({
  app: {
    on: (event: string, listener: IpcListener) => {
      const listeners = mockAppListeners.get(event) ?? [];
      listeners.push(listener);
      mockAppListeners.set(event, listeners);
    },
  },
  BrowserWindow: {
    getAllWindows: () => mockAllWindows,
  },
  ipcMain: {
    on: (channel: string, listener: IpcListener) => {
      const listeners = mockIpcListeners.get(channel) ?? [];
      listeners.push(listener);
      mockIpcListeners.set(channel, listeners);
    },
    handle: (channel: string, handler: IpcListener) => {
      mockIpcHandlers.set(channel, handler);
    },
  },
  webContents: {
    fromId: (id: number) => mockWebContentsById.get(id),
  },
}));

function emitAppEvent(event: string, ...args: unknown[]): void {
  for (const listener of mockAppListeners.get(event) ?? []) {
    listener(...args);
  }
}

function emitIpc(channel: string, ...args: unknown[]): void {
  for (const listener of mockIpcListeners.get(channel) ?? []) {
    listener(...args);
  }
}

function invokeIpc(channel: string, ...args: unknown[]): void {
  mockIpcHandlers.get(channel)?.(...args);
}

function makeWindow(id: number): { id: number; send: jest.Mock } {
  const contents = { id, send: jest.fn() };
  mockWebContentsById.set(id, contents);
  mockAllWindows.push({ webContents: { id } });
  mockStudioWindowIds.add(id);
  return contents;
}

/** Simulates a window closing: no longer a Studio window, no webContents, not in getAllWindows. */
function closeWindow(id: number): void {
  mockStudioWindowIds.delete(id);
  mockWebContentsById.delete(id);
  const index = mockAllWindows.findIndex((window) => window.webContents.id === id);
  if (index >= 0) {
    mockAllWindows.splice(index, 1);
  }
}

const loadDispatch = async (): Promise<typeof import("./dispatch")> => await import("./dispatch");

describe("mcp dispatch", () => {
  beforeEach(() => {
    jest.resetModules();
    mockAppListeners.clear();
    mockIpcListeners.clear();
    mockIpcHandlers.clear();
    mockWebContentsById.clear();
    mockAllWindows.length = 0;
    mockStudioWindowIds.clear();
  });

  it("starts with an empty state snapshot", async () => {
    const dispatch = await loadDispatch();
    expect(dispatch.getMcpState()).toEqual({
      presence: "NOT_PRESENT",
      playerName: undefined,
      topics: [],
      datatypes: {},
    });
  });

  it("resolves a command when the renderer replies on mcp-result", async () => {
    const dispatch = await loadDispatch();
    const contents = makeWindow(7);
    emitAppEvent("browser-window-focus", undefined, { webContents: { id: 7 } });

    const promise = dispatch.sendCommandToFocusedWindow("set-layout", { foo: 1 });
    expect(contents.send).toHaveBeenCalledWith("mcp-command", {
      id: 1,
      type: "set-layout",
      payload: { foo: 1 },
    });

    invokeIpc("mcp-result", undefined, 1, "all done");
    await expect(promise).resolves.toBe("all done");
  });

  it("targets the first window when no window has been focused yet", async () => {
    const dispatch = await loadDispatch();
    const first = makeWindow(5);
    makeWindow(6);

    const promise = dispatch.sendCommandToFocusedWindow("ping", undefined, { timeoutMs: 10 });
    expect(first.send).toHaveBeenCalledWith(
      "mcp-command",
      expect.objectContaining({ id: 1, type: "ping" }),
    );
    await expect(promise).rejects.toThrow("timed out");
  });

  it("rejects a command that times out", async () => {
    const dispatch = await loadDispatch();
    makeWindow(3);
    emitAppEvent("browser-window-focus", undefined, { webContents: { id: 3 } });

    await expect(
      dispatch.sendCommandToFocusedWindow("nope", undefined, { timeoutMs: 10 }),
    ).rejects.toThrow("timed out");
  });

  it("rejects when there is no window to target", async () => {
    const dispatch = await loadDispatch();
    await expect(dispatch.sendCommandToFocusedWindow("x", undefined)).rejects.toThrow("no window");

    // A focused Studio window that has since closed also counts as having no window.
    makeWindow(99);
    emitAppEvent("browser-window-focus", undefined, { webContents: { id: 99 } });
    closeWindow(99);
    await expect(dispatch.sendCommandToFocusedWindow("x", undefined)).rejects.toThrow("no window");
  });

  it("ignores focus events from non-Studio windows (e.g. detached DevTools)", async () => {
    const dispatch = await loadDispatch();
    const studio = makeWindow(7);

    emitAppEvent("browser-window-focus", undefined, { webContents: { id: 8 } });
    // Target is still the first window (7), not the non-Studio window 8.
    const promise = dispatch.sendCommandToFocusedWindow("x", undefined, { timeoutMs: 10 });
    expect(studio.send).toHaveBeenCalledWith(
      "mcp-command",
      expect.objectContaining({ type: "x" }),
    );
    await expect(promise).rejects.toThrow("timed out");
  });

  it("caches snapshots from the focused window and drops snapshots from other windows", async () => {
    const dispatch = await loadDispatch();
    makeWindow(1);
    makeWindow(2);
    emitAppEvent("browser-window-focus", undefined, { webContents: { id: 2 } });

    const fromWindowOne = {
      presence: "PRESENT",
      playerName: "one",
      topics: [{ name: "/one", schemaName: undefined }],
      datatypes: {},
    };
    emitIpc("mcp-state-snapshot", { sender: { id: 1 } }, fromWindowOne);
    expect(dispatch.getMcpState().topics).toEqual([]);

    const fromWindowTwo = {
      presence: "PRESENT",
      playerName: "two",
      topics: [{ name: "/two", schemaName: "std_msgs/String" }],
      datatypes: { "std_msgs/String": { definitions: [] } },
    };
    emitIpc("mcp-state-snapshot", { sender: { id: 2 } }, fromWindowTwo);
    expect(dispatch.getMcpState()).toEqual(fromWindowTwo);
  });
});

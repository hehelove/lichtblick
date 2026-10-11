/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render, waitFor } from "@testing-library/react";

import type { MessagePipelineContext } from "@lichtblick/suite-base/src/components/MessagePipeline";
import MockMessagePipelineProvider from "@lichtblick/suite-base/src/components/MessagePipeline/MockMessagePipelineProvider";
import CurrentLayoutContext, {
  ICurrentLayout,
} from "@lichtblick/suite-base/src/context/CurrentLayoutContext";
import LayoutManagerContext from "@lichtblick/suite-base/src/context/LayoutManagerContext";
import { UserScriptStateProvider } from "@lichtblick/suite-base/src/context/UserScriptStateContext";
import type { ILayoutManager } from "@lichtblick/suite-base/src/services/ILayoutManager";
import type { Layout } from "@lichtblick/suite-base/src/services/ILayoutStorage";
import { PlayerPresence, type Topic } from "@lichtblick/suite-base/src/players/types";
import type { UserScripts } from "@lichtblick/suite-base/src/types/panels";

import McpCommandBridge, {
  executeLayoutCommand,
  executeMcpCommand,
  executePlaybackCommand,
  executeScriptCommand,
  executeScriptRunCommand,
  type ScriptRunCommandDeps,
} from "./McpCommandBridge";
import { Desktop } from "../common/types";

type McpCommandMsg = { id: number; type: string; payload: unknown };

let handler: ((msg: McpCommandMsg) => void) | undefined;
const onMcpCommand = jest.fn((h: (msg: McpCommandMsg) => void) => {
  handler = h;
  return () => {
    handler = undefined;
  };
});
const sendMcpResult = jest.fn();
const mockBridge = { onMcpCommand, sendMcpResult } as unknown as Desktop;
const globalWithBridge = global as unknown as { desktopBridge?: Desktop };

function makeLayoutData(overrides: Record<string, unknown> = {}) {
  return { configById: {}, globalVariables: {}, playbackConfig: { speed: 1 }, version: 1, ...overrides };
}

function makeLayout(overrides: Record<string, unknown> = {}): Layout {
  return {
    id: "layout-1",
    name: "Foo",
    permission: "CREATOR_WRITE",
    baseline: { data: makeLayoutData(), savedAt: "2026-01-02T03:04:05.000Z" },
    working: undefined,
    syncInfo: undefined,
    ...overrides,
  } as unknown as Layout;
}

describe("McpCommandBridge", () => {
  const seekPlayback = jest.fn();
  const startPlayback = jest.fn();
  const pausePlayback = jest.fn();
  const getLayouts = jest.fn();
  const saveNewLayout = jest.fn();
  const setSelectedLayoutId = jest.fn();
  const setUserScripts = jest.fn();
  // Mutable userNodes map standing in for the current layout's script state.
  const userNodes: UserScripts = {};
  const getCurrentLayoutState = () =>
    ({
      selectedLayout: { id: "layout-1", data: { ...makeLayoutData(), userNodes } },
    }) as unknown as ReturnType<ICurrentLayout["actions"]["getCurrentLayoutState"]>;
  const layoutManagerMock = { getLayouts, saveNewLayout } as unknown as ILayoutManager;
  const currentLayoutMock = {
    actions: { setSelectedLayoutId, setUserScripts, getCurrentLayoutState },
  } as unknown as ICurrentLayout;

  beforeEach(() => {
    handler = undefined;
    onMcpCommand.mockClear();
    sendMcpResult.mockClear();
    seekPlayback.mockClear();
    startPlayback.mockClear();
    pausePlayback.mockClear();
    getLayouts.mockReset();
    saveNewLayout.mockReset();
    setSelectedLayoutId.mockReset();
    setUserScripts.mockReset();
    for (const key of Object.keys(userNodes)) {
      delete userNodes[key];
    }
    globalWithBridge.desktopBridge = mockBridge;
  });

  afterEach(() => {
    delete globalWithBridge.desktopBridge;
  });

  const renderBridge = (props: Record<string, unknown> = {}) =>
    render(
      <LayoutManagerContext.Provider value={layoutManagerMock}>
        <CurrentLayoutContext.Provider value={currentLayoutMock}>
          <UserScriptStateProvider>
            <MockMessagePipelineProvider
              presence={PlayerPresence.PRESENT}
              currentTime={{ sec: 5, nsec: 0 }}
              startTime={{ sec: 0, nsec: 0 }}
              endTime={{ sec: 10, nsec: 0 }}
              isPlaying={false}
              seekPlayback={seekPlayback}
              startPlayback={startPlayback}
              pausePlayback={pausePlayback}
              {...props}
            >
              <McpCommandBridge />
            </MockMessagePipelineProvider>
          </UserScriptStateProvider>
        </CurrentLayoutContext.Provider>
      </LayoutManagerContext.Provider>,
    );

  const send = (type: string, payload: unknown) => {
    expect(handler).toBeDefined();
    handler!({ id: 7, type, payload });
  };

  const lastReply = (): { ok: boolean; value?: unknown; error?: string } => {
    expect(sendMcpResult).toHaveBeenCalled();
    const call = sendMcpResult.mock.calls[sendMcpResult.mock.calls.length - 1]!;
    expect(call[0]).toEqual(7); // the reply echoes the command id (all sends use id 7)
    return call[1] as {
      ok: boolean;
      value?: unknown;
      error?: string;
    };
  };

  it("registers a command handler on mount and unregisters on unmount", () => {
    const { unmount } = renderBridge();
    expect(onMcpCommand).toHaveBeenCalledTimes(1);
    expect(handler).toBeDefined();
    unmount();
    expect(handler).toBeUndefined();
  });

  it("renders nothing and registers nothing without a desktop bridge (web)", () => {
    delete globalWithBridge.desktopBridge;
    const { container } = renderBridge();
    expect(container.childElementCount).toEqual(0);
    expect(onMcpCommand).not.toHaveBeenCalled();
  });

  it("clamps an out-of-range set_playback_time into [start, end]", async () => {
    renderBridge();
    send("playback.set_time", { time: 100 });
    await waitFor(() => { expect(seekPlayback).toHaveBeenCalled(); });
    expect(seekPlayback).toHaveBeenCalledWith({ sec: 10, nsec: 0 });
    const reply = lastReply();
    expect(reply.ok).toEqual(true);
    expect(reply.value).toEqual({ time: { sec: 10, nsec: 0, seconds: 10 } });
  });

  it("seeks to the exact time when it is within range, given as {sec, nsec}", async () => {
    renderBridge();
    send("playback.set_time", { time: { sec: 2, nsec: 500000000 } });
    await waitFor(() => { expect(seekPlayback).toHaveBeenCalled(); });
    expect(seekPlayback).toHaveBeenCalledWith({ sec: 2, nsec: 500000000 });
  });

  it("replies with the exact error when the data source has no playback control", async () => {
    renderBridge({ seekPlayback: undefined });
    send("playback.set_time", { time: 1 });
    await waitFor(() => { expect(sendMcpResult).toHaveBeenCalled(); });
    expect(seekPlayback).not.toHaveBeenCalled();
    expect(lastReply()).toEqual({ ok: false, error: "data source does not support playback control" });
  });

  it("replies with the exact error when there is no active data", async () => {
    renderBridge({ noActiveData: true });
    send("playback.set_time", { time: 1 });
    await waitFor(() => { expect(sendMcpResult).toHaveBeenCalled(); });
    expect(lastReply()).toEqual({ ok: false, error: "data source does not support playback control" });
  });

  it("play seeks back to start before starting when at the end", async () => {
    renderBridge({ currentTime: { sec: 10, nsec: 0 } });
    send("playback.play", {});
    await waitFor(() => { expect(startPlayback).toHaveBeenCalled(); });
    expect(seekPlayback).toHaveBeenCalledWith({ sec: 0, nsec: 0 });
    expect(seekPlayback.mock.invocationCallOrder[0]!).toBeLessThan(
      startPlayback.mock.invocationCallOrder[0]!,
    );
    const reply = lastReply();
    expect(reply.ok).toEqual(true);
    expect(reply.value).toEqual({ action: "play", seekedToStart: true });
  });

  it("play mid-stream starts without seeking", async () => {
    renderBridge();
    send("playback.play", {});
    await waitFor(() => { expect(startPlayback).toHaveBeenCalled(); });
    expect(seekPlayback).not.toHaveBeenCalled();
    expect(lastReply().value).toEqual({ action: "play", seekedToStart: false });
  });

  it("pause calls pausePlayback", async () => {
    renderBridge();
    send("playback.pause", {});
    await waitFor(() => { expect(pausePlayback).toHaveBeenCalled(); });
    expect(lastReply().value).toEqual({ action: "pause" });
  });

  it("routes get_state and step through the mounted bridge", async () => {
    renderBridge();
    send("playback.get_state", {});
    await waitFor(() => { expect(sendMcpResult).toHaveBeenCalled(); });
    const state = lastReply() as { ok: boolean; value: Record<string, unknown> };
    expect(state.ok).toEqual(true);
    expect(state.value).toEqual(
      expect.objectContaining({
        currentTime: { sec: 5, nsec: 0, seconds: 5 },
        startTime: { sec: 0, nsec: 0, seconds: 0 },
        endTime: { sec: 10, nsec: 0, seconds: 10 },
        isPlaying: false,
        presence: PlayerPresence.PRESENT,
        playbackControlAvailable: true,
      }),
    );

    send("playback.step", { direction: "backward" });
    await waitFor(() => { expect(seekPlayback).toHaveBeenCalled(); });
    expect(seekPlayback).toHaveBeenCalledWith({ sec: 4, nsec: 900000000 }); // 5s - 100ms default
    expect(lastReply().ok).toEqual(true);
  });

  it("replies with an error for unknown command types", async () => {
    renderBridge();
    send("nope.nope", {});
    await waitFor(() => { expect(sendMcpResult).toHaveBeenCalled(); });
    const reply = lastReply();
    expect(reply.ok).toEqual(false);
    expect(reply.error).toContain("unknown");
  });

  it("routes layout.list_layouts through the mounted bridge to the layout manager", async () => {
    getLayouts.mockResolvedValue([
      makeLayout(),
      makeLayout({ id: "layout-2", name: "Bar", working: { data: makeLayoutData(), savedAt: "2026-02-03T04:05:06.000Z" } }),
    ]);
    renderBridge();
    send("layout.list_layouts", {});
    await waitFor(() => { expect(sendMcpResult).toHaveBeenCalled(); });
    const reply = lastReply();
    expect(reply.ok).toEqual(true);
    expect(reply.value).toEqual({
      layouts: [
        { id: "layout-1", name: "Foo", updatedAt: "2026-01-02T03:04:05.000Z" },
        { id: "layout-2", name: "Bar", updatedAt: "2026-02-03T04:05:06.000Z" },
      ],
    });
  });

  it("full stack: load_layout by name selects the matching layout via the bridge", async () => {
    getLayouts.mockResolvedValue([makeLayout()]);
    renderBridge();
    send("layout.load_layout", { name: "Foo" });
    await waitFor(() => { expect(setSelectedLayoutId).toHaveBeenCalled(); });
    expect(setSelectedLayoutId).toHaveBeenCalledWith("layout-1");
    expect(lastReply()).toEqual({ ok: true, value: { id: "layout-1", name: "Foo" } });
  });

  it("full stack: load_layout with layout_json validates, saves, and selects through the bridge", async () => {
    const data = makeLayoutData({ version: 1 });
    saveNewLayout.mockResolvedValue(makeLayout({ id: "layout-new", name: "imported-layout-1" }));
    renderBridge();
    send("layout.load_layout", { layout_json: JSON.stringify(data) });
    await waitFor(() => { expect(setSelectedLayoutId).toHaveBeenCalled(); });
    expect(saveNewLayout).toHaveBeenCalledWith(
      expect.objectContaining({ data, permission: "CREATOR_WRITE" }),
    );
    expect(setSelectedLayoutId).toHaveBeenCalledWith("layout-new");
    expect(lastReply()).toEqual({ ok: true, value: { id: "layout-new", name: "imported-layout-1" } });
  });

  it("full stack: load_layout with an invalid layout_json replies with the field-level error", async () => {
    renderBridge();
    send("layout.load_layout", { layout_json: JSON.stringify({ nope: true }) });
    await waitFor(() => { expect(sendMcpResult).toHaveBeenCalled(); });
    const reply = lastReply();
    expect(reply.ok).toEqual(false);
    expect(reply.error).toContain('"configById"');
    expect(reply.error).toContain('"globalVariables"');
    expect(reply.error).toContain('"playbackConfig"');
    expect(saveNewLayout).not.toHaveBeenCalled();
  });

  it("routes script.list through the mounted bridge to the current layout's userNodes", async () => {
    userNodes["mcp-script-1"] = { name: "Foo", sourceCode: "// x" };
    userNodes["other"] = { name: "Bar", sourceCode: "// y" };
    renderBridge();
    send("script.list", {});
    await waitFor(() => { expect(sendMcpResult).toHaveBeenCalled(); });
    const reply = lastReply();
    expect(reply.ok).toEqual(true);
    expect(reply.value).toEqual({
      scripts: [
        { id: "mcp-script-1", name: "Foo" },
        { id: "other", name: "Bar" },
      ],
    });
  });

  it("routes script.put through the mounted bridge and applies it via setUserScripts", async () => {
    renderBridge();
    send("script.put", { name: "Foo", sourceCode: "// x" });
    await waitFor(() => { expect(setUserScripts).toHaveBeenCalled(); });
    expect(setUserScripts).toHaveBeenCalledWith({
      "mcp-script-1": { name: "Foo", sourceCode: "// x" },
    });
    const reply = lastReply();
    expect(reply.ok).toEqual(true);
    expect(reply.value).toEqual({ id: "mcp-script-1", name: "Foo", created: true });
  });

  it("routes script.run through the mounted bridge: temp script, live-source error, cleanup", async () => {
    // The mock pipeline's getBatchIterator is hardcoded to undefined (a live source), so a full
    // happy-path run is covered at executor level; this checks routing + cleanup through the tree.
    const tree = (topics: Topic[]) => render(
      <LayoutManagerContext.Provider value={layoutManagerMock}>
        <CurrentLayoutContext.Provider value={currentLayoutMock}>
          <UserScriptStateProvider>
            <MockMessagePipelineProvider presence={PlayerPresence.PRESENT} topics={topics}>
              <McpCommandBridge />
            </MockMessagePipelineProvider>
          </UserScriptStateProvider>
        </CurrentLayoutContext.Provider>
      </LayoutManagerContext.Provider>,
    );

    const view = tree([{ name: "/base", schemaName: "std/Base" }]);
    send("script.run", { sourceCode: "export const inputs=[]; export const output='/out';" });
    // Baseline topics were captured when the command arrived; now the script registers its output.
    view.rerender(
      <LayoutManagerContext.Provider value={layoutManagerMock}>
        <CurrentLayoutContext.Provider value={currentLayoutMock}>
          <UserScriptStateProvider>
            <MockMessagePipelineProvider
              presence={PlayerPresence.PRESENT}
              topics={[{ name: "/base", schemaName: "std/Base" }, { name: "/out", schemaName: "script" }]}
            >
              <McpCommandBridge />
            </MockMessagePipelineProvider>
          </UserScriptStateProvider>
        </CurrentLayoutContext.Provider>
      </LayoutManagerContext.Provider>,
    );

    await waitFor(() => { expect(sendMcpResult).toHaveBeenCalled(); });
    expect(lastReply()).toEqual({ ok: false, error: "live data sources do not support batch script runs" });
    expect(setUserScripts).toHaveBeenNthCalledWith(1, {
      "mcp-run-script": {
        name: "mcp script run",
        sourceCode: "export const inputs=[]; export const output='/out';",
      },
    });
    expect(setUserScripts).toHaveBeenLastCalledWith({ "mcp-run-script": undefined });
    view.unmount();
  });
});

describe("executePlaybackCommand", () => {
  const seekPlayback = jest.fn();
  const startPlayback = jest.fn();
  const pausePlayback = jest.fn();
  const playUntil = jest.fn();

  const activeData = {
    currentTime: { sec: 5, nsec: 0 },
    startTime: { sec: 0, nsec: 0 },
    endTime: { sec: 10, nsec: 0 },
    isPlaying: false,
    speed: 2,
  };

  function makeCtx(overrides: Record<string, unknown> = {}): MessagePipelineContext {
    return {
      playerState: {
        presence: PlayerPresence.PRESENT,
        activeData,
      },
      seekPlayback,
      startPlayback,
      pausePlayback,
      playUntil,
      ...overrides,
    } as unknown as MessagePipelineContext;
  }

  beforeEach(() => {
    seekPlayback.mockClear();
    startPlayback.mockClear();
    pausePlayback.mockClear();
    playUntil.mockClear();
  });

  it("get_playback_state reports times as {sec, nsec} and seconds plus capability", () => {
    const value = executePlaybackCommand({ type: "playback.get_state", payload: {} }, makeCtx());
    expect(value).toEqual({
      currentTime: { sec: 5, nsec: 0, seconds: 5 },
      startTime: { sec: 0, nsec: 0, seconds: 0 },
      endTime: { sec: 10, nsec: 0, seconds: 10 },
      isPlaying: false,
      speed: 2,
      presence: PlayerPresence.PRESENT,
      playbackControlAvailable: true,
    });
  });

  it("get_playback_state without active data reports undefined times and no capability", () => {
    const ctx = makeCtx({
      playerState: { presence: PlayerPresence.INITIALIZING },
      seekPlayback: undefined,
    });
    const value = executePlaybackCommand({ type: "playback.get_state", payload: {} }, ctx);
    expect(value).toEqual({
      currentTime: undefined,
      startTime: undefined,
      endTime: undefined,
      isPlaying: undefined,
      speed: undefined,
      presence: PlayerPresence.INITIALIZING,
      playbackControlAvailable: false,
    });
  });

  it("step forward prefers playUntil and does not seek", () => {
    executePlaybackCommand(
      { type: "playback.step", payload: { direction: "forward" } },
      makeCtx(),
    );
    expect(playUntil).toHaveBeenCalledWith({ sec: 5, nsec: 100000000 });
    expect(seekPlayback).not.toHaveBeenCalled();
  });

  it("step forward falls back to seek when playUntil is unavailable", () => {
    executePlaybackCommand(
      { type: "playback.step", payload: { direction: "forward", seconds: 1 } },
      makeCtx({ playUntil: undefined }),
    );
    expect(seekPlayback).toHaveBeenCalledWith({ sec: 6, nsec: 0 });
  });

  it("step backward always seeks with the computed time", () => {
    const value = executePlaybackCommand(
      { type: "playback.step", payload: { direction: "backward" } },
      makeCtx(),
    );
    expect(seekPlayback).toHaveBeenCalledWith({ sec: 4, nsec: 900000000 });
    expect(playUntil).not.toHaveBeenCalled();
    expect(value).toEqual({
      steppedTo: { sec: 4, nsec: 900000000, seconds: 4.9 },
      via: "seek",
    });
  });

  it("step without seekPlayback throws the capability error", () => {
    expect(() =>
      executePlaybackCommand(
        { type: "playback.step", payload: { direction: "forward" } },
        makeCtx({ seekPlayback: undefined }),
      ),
    ).toThrow("data source does not support playback control");
  });
});

describe("executeLayoutCommand", () => {
  const getLayouts = jest.fn();
  const saveNewLayout = jest.fn();
  const setSelectedLayoutId = jest.fn();
  const deps = {
    layoutManager: { getLayouts, saveNewLayout } as unknown as ILayoutManager,
    setSelectedLayoutId,
  };

  beforeEach(() => {
    getLayouts.mockReset();
    saveNewLayout.mockReset();
    setSelectedLayoutId.mockReset();
  });

  it("list_layouts maps layouts to id/name/updatedAt, preferring the working copy's save time", async () => {
    getLayouts.mockResolvedValue([
      makeLayout(),
      makeLayout({
        id: "layout-2",
        name: "Bar",
        working: { data: makeLayoutData(), savedAt: "2026-02-03T04:05:06.000Z" },
      }),
    ]);
    const value = await executeLayoutCommand({ type: "layout.list_layouts", payload: {} }, deps);
    expect(value).toEqual({
      layouts: [
        { id: "layout-1", name: "Foo", updatedAt: "2026-01-02T03:04:05.000Z" },
        { id: "layout-2", name: "Bar", updatedAt: "2026-02-03T04:05:06.000Z" },
      ],
    });
  });

  it("get_layout returns the working copy when present, else the baseline", async () => {
    const workingData = makeLayoutData({ version: 1 });
    const baselineData = makeLayoutData({ version: 0 });
    getLayouts.mockResolvedValue([
      makeLayout({ working: { data: workingData, savedAt: undefined } }),
      makeLayout({ id: "layout-2", name: "Bar", baseline: { data: baselineData, savedAt: undefined } }),
    ]);
    await expect(
      executeLayoutCommand({ type: "layout.get_layout", payload: { name: "Foo" } }, deps),
    ).resolves.toEqual(workingData);
    await expect(
      executeLayoutCommand({ type: "layout.get_layout", payload: { name: "Bar" } }, deps),
    ).resolves.toEqual(baselineData);
  });

  it("get_layout throws for an unknown name", async () => {
    getLayouts.mockResolvedValue([makeLayout()]);
    await expect(
      executeLayoutCommand({ type: "layout.get_layout", payload: { name: "Nope" } }, deps),
    ).rejects.toThrow("layout not found: Nope");
  });

  it("load_layout with valid layout_json validates, saves, and selects the new layout", async () => {
    const data = makeLayoutData({ version: 1 });
    saveNewLayout.mockResolvedValue(makeLayout({ id: "layout-new", name: "imported-layout-x" }));
    const value = await executeLayoutCommand(
      { type: "layout.load_layout", payload: { layout_json: JSON.stringify(data) } },
      deps,
    );
    expect(saveNewLayout).toHaveBeenCalledWith(
      expect.objectContaining({ data, permission: "CREATOR_WRITE" }),
    );
    expect(setSelectedLayoutId).toHaveBeenCalledWith("layout-new");
    expect(value).toEqual({ id: "layout-new", name: "imported-layout-x" });
  });

  it("load_layout accepts a layout_json object without re-parsing", async () => {
    const data = makeLayoutData();
    saveNewLayout.mockResolvedValue(makeLayout({ id: "layout-new" }));
    await executeLayoutCommand({ type: "layout.load_layout", payload: { layout_json: data } }, deps);
    expect(saveNewLayout).toHaveBeenCalledWith(expect.objectContaining({ data }));
  });

  it("load_layout passes the field-level validation error through", async () => {
    await expect(
      executeLayoutCommand(
        { type: "layout.load_layout", payload: { layout_json: JSON.stringify({ nope: true }) } },
        deps,
      ),
    ).rejects.toThrow('missing or invalid fields: "configById", "globalVariables", "playbackConfig"');
    expect(saveNewLayout).not.toHaveBeenCalled();
  });

  it("load_layout passes a JSON parse error through", async () => {
    await expect(
      executeLayoutCommand(
        { type: "layout.load_layout", payload: { layout_json: "{not json" } },
        deps,
      ),
    ).rejects.toThrow();
    expect(saveNewLayout).not.toHaveBeenCalled();
  });

  it("load_layout by name selects the matching layout", async () => {
    getLayouts.mockResolvedValue([makeLayout()]);
    const value = await executeLayoutCommand(
      { type: "layout.load_layout", payload: { name: "Foo" } },
      deps,
    );
    expect(setSelectedLayoutId).toHaveBeenCalledWith("layout-1");
    expect(saveNewLayout).not.toHaveBeenCalled();
    expect(value).toEqual({ id: "layout-1", name: "Foo" });
  });

  it("load_layout by name throws for an unknown name", async () => {
    getLayouts.mockResolvedValue([makeLayout()]);
    await expect(
      executeLayoutCommand({ type: "layout.load_layout", payload: { name: "Nope" } }, deps),
    ).rejects.toThrow("layout not found: Nope");
    expect(setSelectedLayoutId).not.toHaveBeenCalled();
  });

  it("load_layout errors when the layout_json version exceeds the supported version", async () => {
    await expect(
      executeLayoutCommand(
        { type: "layout.load_layout", payload: { layout_json: JSON.stringify(makeLayoutData({ version: 99 })) } },
        deps,
      ),
    ).rejects.toThrow("version");
    expect(saveNewLayout).not.toHaveBeenCalled();
  });

  it("load_layout by name errors when the stored version exceeds the supported version", async () => {
    getLayouts.mockResolvedValue([makeLayout({ baseline: { data: makeLayoutData({ version: 99 }), savedAt: undefined } })]);
    await expect(
      executeLayoutCommand({ type: "layout.load_layout", payload: { name: "Foo" } }, deps),
    ).rejects.toThrow("version");
    expect(setSelectedLayoutId).not.toHaveBeenCalled();
  });

  it("load_layout errors when neither parameter is provided", async () => {
    await expect(
      executeLayoutCommand({ type: "layout.load_layout", payload: {} }, deps),
    ).rejects.toThrow("provide exactly one of name or layout_json");
  });

  it("load_layout errors when both parameters are provided", async () => {
    await expect(
      executeLayoutCommand(
        { type: "layout.load_layout", payload: { name: "Foo", layout_json: "{}" } },
        deps,
      ),
    ).rejects.toThrow("provide exactly one of name or layout_json");
  });
});

describe("executeScriptCommand", () => {
  // Hand-built deps mirroring the reducer's SET_USER_NODES semantics: merge by key, undefined deletes.
  function makeScriptDeps(initial: UserScripts = {}) {
    const userNodes: UserScripts = { ...initial };
    const setUserScripts = jest.fn((payload: Partial<UserScripts>) => {
      for (const [key, value] of Object.entries(payload)) {
        if (value == undefined) {
          delete userNodes[key];
        } else {
          userNodes[key] = value;
        }
      }
    });
    return { getUserScripts: () => userNodes, setUserScripts };
  }

  it("list maps userNodes to {scripts: [{id, name}]}", () => {
    const deps = makeScriptDeps({
      "mcp-script-1": { name: "Foo", sourceCode: "// x" },
      other: { name: "Bar", sourceCode: "// y" },
    });
    const value = executeScriptCommand({ type: "script.list", payload: {} }, deps);
    expect(value).toEqual({
      scripts: [
        { id: "mcp-script-1", name: "Foo" },
        { id: "other", name: "Bar" },
      ],
    });
    expect(deps.setUserScripts).not.toHaveBeenCalled();
  });

  it("put without an id creates mcp-script-1 on an empty layout", () => {
    const deps = makeScriptDeps();
    const value = executeScriptCommand(
      { type: "script.put", payload: { name: "Foo", sourceCode: "// x" } },
      deps,
    );
    expect(value).toEqual({ id: "mcp-script-1", name: "Foo", created: true });
    expect(deps.setUserScripts).toHaveBeenCalledWith({
      "mcp-script-1": { name: "Foo", sourceCode: "// x" },
    });
  });

  it("put allocates 1 + the max existing mcp-script-N suffix, skipping gaps", () => {
    const deps = makeScriptDeps({
      "mcp-script-1": { name: "A", sourceCode: "// a" },
      "mcp-script-5": { name: "B", sourceCode: "// b" },
      "mcp-script-x": { name: "C", sourceCode: "// c" }, // non-numeric suffix: ignored
      unrelated: { name: "D", sourceCode: "// d" }, // other keys: never reallocated
    });
    const value = executeScriptCommand(
      { type: "script.put", payload: { name: "E", sourceCode: "// e" } },
      deps,
    );
    expect(value).toEqual({ id: "mcp-script-6", name: "E", created: true });
    expect(Object.keys(deps.getUserScripts())).toEqual(
      expect.arrayContaining(["mcp-script-1", "mcp-script-5", "mcp-script-x", "unrelated", "mcp-script-6"]),
    );
  });

  it("put with an existing id overwrites only that script and reports created: false", () => {
    const deps = makeScriptDeps({
      "mcp-script-1": { name: "Old", sourceCode: "// old" },
      other: { name: "Keep", sourceCode: "// keep" },
    });
    const value = executeScriptCommand(
      { type: "script.put", payload: { id: "mcp-script-1", name: "New", sourceCode: "// new" } },
      deps,
    );
    expect(value).toEqual({ id: "mcp-script-1", name: "New", created: false });
    expect(deps.getUserScripts()).toEqual({
      "mcp-script-1": { name: "New", sourceCode: "// new" },
      other: { name: "Keep", sourceCode: "// keep" },
    });
  });

  it("put with an unknown explicit id upserts under that id", () => {
    const deps = makeScriptDeps({ other: { name: "Keep", sourceCode: "// keep" } });
    const value = executeScriptCommand(
      { type: "script.put", payload: { id: "custom-id", name: "Foo", sourceCode: "// x" } },
      deps,
    );
    expect(value).toEqual({ id: "custom-id", name: "Foo", created: true });
    expect(deps.getUserScripts()["custom-id"]).toEqual({ name: "Foo", sourceCode: "// x" });
    expect(deps.getUserScripts()["other"]).toEqual({ name: "Keep", sourceCode: "// keep" });
  });

  it("put rejects empty or non-string name and sourceCode without dispatching", () => {
    const deps = makeScriptDeps();
    for (const payload of [
      { name: "", sourceCode: "// x" },
      { name: "Foo", sourceCode: "" },
      { sourceCode: "// x" },
      { name: "Foo" },
      { name: 42, sourceCode: "// x" },
    ]) {
      expect(() => executeScriptCommand({ type: "script.put", payload }, deps)).toThrow();
    }
    expect(deps.setUserScripts).not.toHaveBeenCalled();
  });

  it("get returns name and sourceCode on a hit", () => {
    const deps = makeScriptDeps({ "mcp-script-1": { name: "Foo", sourceCode: "1+1" } });
    const value = executeScriptCommand({ type: "script.get", payload: { id: "mcp-script-1" } }, deps);
    expect(value).toEqual({ name: "Foo", sourceCode: "1+1" });
  });

  it("get throws for an unknown id", () => {
    const deps = makeScriptDeps();
    expect(() => executeScriptCommand({ type: "script.get", payload: { id: "nope" } }, deps)).toThrow(
      "user script not found: nope",
    );
  });

  it("delete removes the script so list no longer contains it", () => {
    const deps = makeScriptDeps({
      "mcp-script-1": { name: "Foo", sourceCode: "// x" },
      other: { name: "Bar", sourceCode: "// y" },
    });
    const value = executeScriptCommand(
      { type: "script.delete", payload: { id: "mcp-script-1" } },
      deps,
    );
    expect(value).toEqual({ id: "mcp-script-1", deleted: true });
    expect(deps.setUserScripts).toHaveBeenCalledWith({ "mcp-script-1": undefined });
    expect(executeScriptCommand({ type: "script.list", payload: {} }, deps)).toEqual({
      scripts: [{ id: "other", name: "Bar" }],
    });
  });

  it("delete of a missing id errors without dispatching (no silent success)", () => {
    const deps = makeScriptDeps();
    expect(() => executeScriptCommand({ type: "script.delete", payload: { id: "nope" } }, deps)).toThrow(
      "user script not found: nope",
    );
    expect(deps.setUserScripts).not.toHaveBeenCalled();
  });

  it("throws for unknown script commands", () => {
    expect(() =>
      executeScriptCommand({ type: "script.run", payload: {} }, makeScriptDeps()),
    ).toThrow("unknown");
  });
});


describe("executeScriptRunCommand", () => {
  const RUN_ID = "mcp-run-script";

  /** A fake async iterator yielding the given batch-iterator results. */
  function fakeIterator(results: unknown[], gate?: Promise<void>) {
    const state = { nextCalls: 0 };
    const it = {
      async next(): Promise<IteratorResult<unknown>> {
        state.nextCalls++;
        await gate;
        if (state.nextCalls > results.length) {
          return { done: true as const, value: undefined };
        }
        return { done: false as const, value: results[state.nextCalls - 1]! };
      },
      return: jest.fn(async () => ({ done: true as const, value: undefined }) as IteratorResult<unknown>),
      [Symbol.asyncIterator]() {
        return it;
      },
    };
    return { it: it as unknown as AsyncIterableIterator<unknown>, state };
  }

  const msgEvent = (i: number) => ({
    type: "message-event",
    msgEvent: {
      topic: "/script_out",
      schemaName: "script",
      receiveTime: { sec: i, nsec: 0 },
      publishTime: { sec: i, nsec: 1 },
      sizeInBytes: 8,
      message: { index: i },
    },
  });

  const serialized = (i: number) => ({
    topic: "/script_out",
    schemaName: "script",
    receiveTime: { sec: i, nsec: 0 },
    publishTime: { sec: i, nsec: 1 },
    sizeInBytes: 8,
    message: { index: i },
  });

  type Wired = {
    deps: ScriptRunCommandDeps;
    userNodes: UserScripts;
    setUserScripts: jest.Mock;
    topics: Topic[];
    getBatchIterator: jest.Mock;
  };

  /**
   * Deps with a mutable layout + player state. By default, writing the temp script makes the
   * output topic appear in player state (standing in for UserScriptPlayer re-registration);
   * override onWriteScript for timeout/ambiguity cases, iterator for the batch path.
   * Script state mirrors the real UserScriptState store: it holds `initialScriptState` until the
   * script is written, and `scriptStateOnWrite` replaces it (with a FRESH array, like the store)
   * when the run's script lands.
   */
  function makeWired(
    opts: {
      onWriteScript?: () => void;
      iterator?: (topic: string) => AsyncIterableIterator<unknown> | undefined;
      initialScriptState?: { diagnostics: unknown[]; logs: unknown[] };
      scriptStateOnWrite?: () => { diagnostics: unknown[]; logs: unknown[] } | undefined;
      pollIntervalMs?: number;
      pollTimeoutMs?: number;
    } = {},
  ): Wired {
    const userNodes: UserScripts = {};
    let scriptState = opts.initialScriptState;
    const setUserScripts = jest.fn((payload: Partial<UserScripts>) => {
      for (const [key, value] of Object.entries(payload)) {
        if (value == undefined) {
          delete userNodes[key];
        } else {
          userNodes[key] = value;
        }
      }
      if (payload[RUN_ID] != undefined) {
        if (opts.scriptStateOnWrite != undefined) {
          scriptState = opts.scriptStateOnWrite();
        }
        (opts.onWriteScript ?? (() => topics.push({ name: "/script_out", schemaName: "script" })))();
      }
    });
    const topics: Topic[] = [{ name: "/base", schemaName: "std/Base" }];
    const getBatchIterator = jest.fn((topic: string) => opts.iterator?.(topic));
    const deps: ScriptRunCommandDeps = {
      getUserScripts: () => userNodes,
      setUserScripts,
      getPipeline: () =>
        ({
          playerState: { presence: PlayerPresence.PRESENT, activeData: { topics } },
          getBatchIterator,
        }) as unknown as ReturnType<ScriptRunCommandDeps["getPipeline"]>,
      getScriptState: (scriptId) =>
        (scriptId === RUN_ID ? scriptState : undefined) as ReturnType<
          ScriptRunCommandDeps["getScriptState"]
        >,
      pollIntervalMs: opts.pollIntervalMs,
      pollTimeoutMs: opts.pollTimeoutMs,
    };
    return { deps, userNodes, setUserScripts, topics, getBatchIterator };
  }

  const defaultIterator = (results: unknown[], gate?: Promise<void>) => (topic: string) =>
    topic === "/script_out" ? fakeIterator(results, gate).it : undefined;

  const run = (payload: unknown, deps: ScriptRunCommandDeps) =>
    executeScriptRunCommand({ type: "script.run", payload }, deps);

  it("writes the temp script, waits for the output topic, and returns the collected messages", async () => {
    const wired = makeWired({
      iterator: defaultIterator([
        { type: "stamp", stamp: { sec: 0, nsec: 0 } }, // stamps are not script output
        msgEvent(0),
        msgEvent(1),
        msgEvent(2),
      ]),
    });
    const value = await run({ sourceCode: "// x" }, wired.deps);
    expect(value).toEqual({
      outputTopic: "/script_out",
      schemaName: "script",
      count: 3,
      messages: [serialized(0), serialized(1), serialized(2)],
      logs: [],
      diagnostics: [],
    });
    // Temp script written under the fixed id, then removed in the finally.
    expect(wired.setUserScripts).toHaveBeenNthCalledWith(1, {
      [RUN_ID]: { name: "mcp script run", sourceCode: "// x" },
    });
    expect(wired.setUserScripts).toHaveBeenLastCalledWith({ [RUN_ID]: undefined });
    expect(wired.userNodes[RUN_ID]).toEqual(undefined);
  });

  it("uses the optional name for the temp script", async () => {
    const wired = makeWired({ iterator: defaultIterator([msgEvent(0)]) });
    await run({ sourceCode: "// x", name: "Foo" }, wired.deps);
    expect(wired.setUserScripts).toHaveBeenNthCalledWith(1, {
      [RUN_ID]: { name: "Foo", sourceCode: "// x" },
    });
  });

  it("truncates at maxMessages and stops pulling from the iterator", async () => {
    const it = fakeIterator([msgEvent(0), msgEvent(1), msgEvent(2), msgEvent(3), msgEvent(4)]);
    const wired = makeWired({ iterator: () => it.it });
    const value = await run({ sourceCode: "// x", maxMessages: 2 }, wired.deps);
    expect(value).toEqual(
      expect.objectContaining({ count: 2, messages: [serialized(0), serialized(1)] }),
    );
    expect(it.state.nextCalls).toEqual(2); // messages beyond maxMessages are not collected
    expect(it.it.return).toHaveBeenCalled(); // for-await break releases the iterator
  });

  it("rejects live sources with the exact error and cleans up the temp script", async () => {
    const wired = makeWired({ iterator: () => undefined });
    await expect(run({ sourceCode: "// x" }, wired.deps)).rejects.toThrow(
      "live data sources do not support batch script runs",
    );
    expect(wired.setUserScripts).toHaveBeenLastCalledWith({ [RUN_ID]: undefined });
    expect(wired.userNodes[RUN_ID]).toEqual(undefined);
  });

  it("fails with a timeout error naming what was awaited and cleans up", async () => {
    const wired = makeWired({ onWriteScript: () => {}, pollIntervalMs: 2, pollTimeoutMs: 10 });
    await expect(run({ sourceCode: "// x" }, wired.deps)).rejects.toThrow(
      /timed out after 10ms waiting for the script output topic/,
    );
    expect(wired.setUserScripts).toHaveBeenLastCalledWith({ [RUN_ID]: undefined });
    expect(wired.userNodes[RUN_ID]).toEqual(undefined);
  });

  it("fails with a discriminating error when multiple new topics appear", async () => {
    const wired = makeWired({
      onWriteScript: () => {
        wired.topics.push({ name: "/a", schemaName: "script" }, { name: "/b", schemaName: "script" });
      },
    });
    await expect(run({ sourceCode: "// x" }, wired.deps)).rejects.toThrow(/ambiguous.*\/a.*\/b/);
    expect(wired.setUserScripts).toHaveBeenLastCalledWith({ [RUN_ID]: undefined });
  });

  it("returns script logs and diagnostics from the user script state", async () => {
    const wired = makeWired({
      iterator: defaultIterator([msgEvent(0)]),
      scriptStateOnWrite: () => ({
        diagnostics: [{ severity: 4, message: "unused variable", source: "Typescript", code: 1 }],
        logs: [{ source: "processMessage", value: { hello: 1 } }],
      }),
    });
    const value = (await run({ sourceCode: "// x" }, wired.deps)) as Record<string, unknown>;
    expect(value["logs"]).toEqual([{ source: "processMessage", value: { hello: 1 } }]);
    expect(value["diagnostics"]).toEqual([
      { severity: 4, message: "unused variable", source: "Typescript", code: 1 },
    ]);
  });

  it("fails fast with fresh error diagnostics when registration reports errors", async () => {
    const wired = makeWired({
      // No topic ever appears; without diagnostics this would hit the (long) poll cap.
      onWriteScript: () => {},
      // Registration writes a fresh diagnostics array carrying this run's compile error.
      scriptStateOnWrite: () => ({
        diagnostics: [
          { severity: 8, message: "Cannot find name 'florble'", source: "Typescript", code: 2 },
        ],
        logs: [],
      }),
      pollIntervalMs: 1,
      pollTimeoutMs: 60_000,
    });
    await expect(run({ sourceCode: "florble" }, wired.deps)).rejects.toThrow(/florble/);
    expect(wired.setUserScripts).toHaveBeenLastCalledWith({ [RUN_ID]: undefined });
  });

  it("is not poisoned by a failed previous run's leftover error diagnostics", async () => {
    // The player never clears diagnostics on failure (only on successful registration), so the
    // store still holds run 1's Error diagnostics when run 2 starts. Run 2's own script is fine
    // and registers its output topic — it must succeed despite the stale array.
    const wired = makeWired({
      initialScriptState: {
        diagnostics: [
          { severity: 8, message: "previous run's error", source: "Typescript", code: 9 },
        ],
        logs: [],
      },
      // The topic lands only after the first poll tick, so tick 1 has no candidates and actually
      // reads the stale diagnostics — where pre-fix code rejected with the previous run's error.
      onWriteScript: () => {
        setTimeout(() => wired.topics.push({ name: "/script_out", schemaName: "script" }), 5);
      },
      iterator: defaultIterator([msgEvent(0)]),
      pollIntervalMs: 1,
    });
    const value = (await run({ sourceCode: "// fixed" }, wired.deps)) as Record<string, unknown>;
    expect(value["count"]).toEqual(1);
    expect(wired.userNodes[RUN_ID]).toEqual(undefined);
  });

  it("clears the busy flag when a pre-write read throws, without restoring", async () => {
    const wired = makeWired({});
    wired.deps.getUserScripts = () => {
      throw new Error("layout read failed");
    };
    await expect(run({ sourceCode: "// x" }, wired.deps)).rejects.toThrow("layout read failed");
    // Nothing was written, so the finally must not dispatch a restore write either.
    expect(wired.setUserScripts).not.toHaveBeenCalled();
    // The busy flag was cleared: a second run proceeds past the busy check (and hits the same
    // read error again, not "a script run is already in progress").
    await expect(run({ sourceCode: "// x" }, wired.deps)).rejects.toThrow("layout read failed");
  });

  it("cleans up when the batch iterator throws mid-collection", async () => {
    let calls = 0;
    const throwing = {
      async next(): Promise<IteratorResult<unknown>> {
        if (calls++ === 0) {
          return { done: false as const, value: msgEvent(0) };
        }
        throw new Error("iterator exploded");
      },
      [Symbol.asyncIterator]() {
        return throwing as unknown as AsyncIterableIterator<unknown>;
      },
    };
    const wired = makeWired({
      iterator: () => throwing as unknown as AsyncIterableIterator<unknown>,
    });
    await expect(run({ sourceCode: "// x", maxMessages: 10 }, wired.deps)).rejects.toThrow(
      "iterator exploded",
    );
    expect(wired.setUserScripts).toHaveBeenLastCalledWith({ [RUN_ID]: undefined });
    expect(wired.userNodes[RUN_ID]).toEqual(undefined);
  });

  it("rejects a concurrent second run while the first is in flight, first unaffected", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const wired = makeWired({ iterator: defaultIterator([msgEvent(0), msgEvent(1)], gate) });
    const first = run({ sourceCode: "// x" }, wired.deps);
    // Wait until the first run is parked inside the batch iterator.
    await waitFor(() => { expect(wired.getBatchIterator).toHaveBeenCalledWith("/script_out"); });
    await expect(run({ sourceCode: "// y" }, wired.deps)).rejects.toThrow(
      "a script run is already in progress",
    );
    release();
    const value = (await first) as Record<string, unknown>;
    expect(value["count"]).toEqual(2);
    // The busy rejection happened before any write; only the first run wrote and cleaned up.
    expect(wired.setUserScripts).toHaveBeenCalledTimes(2);
  });

  it("restores a pre-existing script that occupied the reserved id", async () => {
    const wired = makeWired({ iterator: defaultIterator([msgEvent(0)]) });
    const original = { name: "User script", sourceCode: "// user" };
    wired.userNodes[RUN_ID] = original;
    await run({ sourceCode: "// x" }, wired.deps);
    expect(wired.setUserScripts).toHaveBeenLastCalledWith({ [RUN_ID]: original });
    expect(wired.userNodes[RUN_ID]).toEqual(original);
  });

  it("rejects invalid payloads without touching the layout", async () => {
    for (const payload of [
      {},
      { sourceCode: "" },
      { sourceCode: 42 },
      { sourceCode: "// x", maxMessages: 0 },
      { sourceCode: "// x", maxMessages: 1.5 },
      { sourceCode: "// x", name: 7 },
    ]) {
      const wired = makeWired();
      await expect(run(payload, wired.deps)).rejects.toThrow();
      expect(wired.setUserScripts).not.toHaveBeenCalled();
    }
  });

  it("executeMcpCommand routes script.run to the run executor (not script CRUD)", async () => {
    const wired = makeWired({ iterator: defaultIterator([msgEvent(0)]) });
    const ctx = { playerState: {}, getBatchIterator: jest.fn() } as unknown as MessagePipelineContext;
    const value = (await executeMcpCommand(
      { type: "script.run", payload: { sourceCode: "// x" } },
      ctx,
      { layoutManager: {} as unknown as ILayoutManager, setSelectedLayoutId: jest.fn() },
      { getUserScripts: wired.deps.getUserScripts, setUserScripts: wired.deps.setUserScripts },
      wired.deps,
    )) as Record<string, unknown>;
    expect(value["outputTopic"]).toEqual("/script_out");
  });
});

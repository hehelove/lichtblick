/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render, waitFor } from "@testing-library/react";

import type { MessagePipelineContext } from "@lichtblick/suite-base/components/MessagePipeline";
import MockMessagePipelineProvider from "@lichtblick/suite-base/components/MessagePipeline/MockMessagePipelineProvider";
import CurrentLayoutContext, {
  ICurrentLayout,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import LayoutManagerContext from "@lichtblick/suite-base/context/LayoutManagerContext";
import type { ILayoutManager } from "@lichtblick/suite-base/services/ILayoutManager";
import type { Layout } from "@lichtblick/suite-base/services/ILayoutStorage";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";

import McpCommandBridge, { executeLayoutCommand, executePlaybackCommand } from "./McpCommandBridge";
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
  const layoutManagerMock = { getLayouts, saveNewLayout } as unknown as ILayoutManager;
  const currentLayoutMock = { actions: { setSelectedLayoutId } } as unknown as ICurrentLayout;

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
    globalWithBridge.desktopBridge = mockBridge;
  });

  afterEach(() => {
    delete globalWithBridge.desktopBridge;
  });

  const renderBridge = (props: Record<string, unknown> = {}) =>
    render(
      <LayoutManagerContext.Provider value={layoutManagerMock}>
        <CurrentLayoutContext.Provider value={currentLayoutMock}>
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

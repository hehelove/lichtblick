/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render, waitFor } from "@testing-library/react";

import type { MessagePipelineContext } from "@lichtblick/suite-base/components/MessagePipeline";
import MockMessagePipelineProvider from "@lichtblick/suite-base/components/MessagePipeline/MockMessagePipelineProvider";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";

import McpCommandBridge, { executePlaybackCommand } from "./McpCommandBridge";
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

describe("McpCommandBridge", () => {
  const seekPlayback = jest.fn();
  const startPlayback = jest.fn();
  const pausePlayback = jest.fn();

  beforeEach(() => {
    handler = undefined;
    onMcpCommand.mockClear();
    sendMcpResult.mockClear();
    seekPlayback.mockClear();
    startPlayback.mockClear();
    pausePlayback.mockClear();
    globalWithBridge.desktopBridge = mockBridge;
  });

  afterEach(() => {
    delete globalWithBridge.desktopBridge;
  });

  const renderBridge = (props: Record<string, unknown> = {}) =>
    render(
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
      </MockMessagePipelineProvider>,
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

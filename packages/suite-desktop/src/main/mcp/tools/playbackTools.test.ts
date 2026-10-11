// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { registerPlaybackTools } from "./playbackTools";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type RegisteredTool = {
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  inputSchema?: Record<string, unknown>;
  cb: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
};

const sendCommand = jest.fn();

function makeTools(): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const fakeMcp = {
    registerTool: (
      name: string,
      config: {
        annotations?: RegisteredTool["annotations"];
        inputSchema?: RegisteredTool["inputSchema"];
      },
      cb: RegisteredTool["cb"],
    ) => {
      tools.set(name, { ...config, cb });
    },
  };
  registerPlaybackTools(fakeMcp as unknown as Parameters<typeof registerPlaybackTools>[0], {
    sendCommand,
  });
  return tools;
}

async function callTool(tool: RegisteredTool, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return await tool.cb(args);
}

function parseJson(result: ToolResult): unknown {
  expect(result.content).toHaveLength(1);
  expect(result.content[0]!.type).toEqual("text");
  return JSON.parse(result.content[0]!.text) as unknown;
}

const TOOL_NAMES = ["get_playback_state", "pause", "play", "set_playback_time", "step"];

describe("mcp playback tools", () => {
  beforeEach(() => {
    sendCommand.mockReset();
  });

  it("registers the five playback tools with honest annotations", () => {
    const tools = makeTools();
    expect([...tools.keys()].sort()).toEqual(TOOL_NAMES.slice().sort());

    const state = tools.get("get_playback_state")!;
    expect(state.annotations?.readOnlyHint).toEqual(true);

    // The mutating tools must not claim to be read-only, and none of them are destructive.
    for (const name of ["set_playback_time", "play", "pause", "step"]) {
      const tool = tools.get(name)!;
      expect(tool.annotations?.readOnlyHint).toEqual(false);
      expect(tool.annotations?.destructiveHint).toEqual(false);
    }

    // Seeking/playing/pausing twice lands in the same place; stepping twice does not.
    expect(tools.get("set_playback_time")!.annotations?.idempotentHint).toEqual(true);
    expect(tools.get("play")!.annotations?.idempotentHint).toEqual(true);
    expect(tools.get("pause")!.annotations?.idempotentHint).toEqual(true);
    expect(tools.get("step")!.annotations?.idempotentHint).toEqual(false);
  });

  it("get_playback_state sends the command and unwraps a successful reply", async () => {
    sendCommand.mockResolvedValue({
      ok: true,
      value: {
        currentTime: { sec: 5, nsec: 0, seconds: 5 },
        startTime: { sec: 0, nsec: 0, seconds: 0 },
        endTime: { sec: 10, nsec: 0, seconds: 10 },
        isPlaying: false,
        speed: 1,
        presence: "PRESENT",
        playbackControlAvailable: true,
      },
    });

    const result = await callTool(makeTools().get("get_playback_state")!);

    expect(sendCommand).toHaveBeenCalledWith("playback.get_state", {});
    expect(result.isError).toEqual(undefined);
    expect(parseJson(result)).toEqual({
      currentTime: { sec: 5, nsec: 0, seconds: 5 },
      startTime: { sec: 0, nsec: 0, seconds: 0 },
      endTime: { sec: 10, nsec: 0, seconds: 10 },
      isPlaying: false,
      speed: 1,
      presence: "PRESENT",
      playbackControlAvailable: true,
    });
  });

  it("set_playback_time accepts seconds or {sec, nsec} and forwards the payload", async () => {
    const tools = makeTools();
    const shape = tools.get("set_playback_time")!.inputSchema ?? {};
    expect(Object.keys(shape).sort()).toEqual(["time"]);
    const time = shape["time"] as { safeParse: (v: unknown) => { success: boolean } };
    expect(time.safeParse(12.5).success).toEqual(true);
    expect(time.safeParse({ sec: 12, nsec: 500 }).success).toEqual(true);
    expect(time.safeParse("12.5").success).toEqual(false);
    expect(time.safeParse(undefined).success).toEqual(false); // required

    sendCommand.mockResolvedValue({ ok: true, value: { time: { sec: 12, nsec: 500000000, seconds: 12.5 } } });
    const result = await callTool(tools.get("set_playback_time")!, { time: 12.5 });

    expect(sendCommand).toHaveBeenCalledWith("playback.set_time", { time: 12.5 });
    expect(parseJson(result)).toEqual({ time: { sec: 12, nsec: 500000000, seconds: 12.5 } });
  });

  it("play and pause send their commands without a payload", async () => {
    const tools = makeTools();
    sendCommand.mockResolvedValue({ ok: true, value: { action: "play", seekedToStart: true } });
    await callTool(tools.get("play")!);
    expect(sendCommand).toHaveBeenCalledWith("playback.play", {});

    sendCommand.mockResolvedValue({ ok: true, value: { action: "pause" } });
    await callTool(tools.get("pause")!);
    expect(sendCommand).toHaveBeenCalledWith("playback.pause", {});
  });

  it("step validates direction and optional positive seconds, and forwards the payload", async () => {
    const tools = makeTools();
    const shape = tools.get("step")!.inputSchema ?? {};
    const direction = shape["direction"] as { safeParse: (v: unknown) => { success: boolean } };
    expect(direction.safeParse("forward").success).toEqual(true);
    expect(direction.safeParse("backward").success).toEqual(true);
    expect(direction.safeParse("sideways").success).toEqual(false);
    expect(direction.safeParse(undefined).success).toEqual(false); // required
    const seconds = shape["seconds"] as { safeParse: (v: unknown) => { success: boolean } };
    expect(seconds.safeParse(undefined).success).toEqual(true); // optional
    expect(seconds.safeParse(0.5).success).toEqual(true);
    expect(seconds.safeParse(-1).success).toEqual(false);
    expect(seconds.safeParse("0.5").success).toEqual(false);

    sendCommand.mockResolvedValue({ ok: true, value: { steppedTo: { sec: 5, nsec: 100000000, seconds: 5.1 } } });
    const result = await callTool(tools.get("step")!, { direction: "forward" });
    expect(sendCommand).toHaveBeenCalledWith("playback.step", { direction: "forward", seconds: undefined });
    expect(parseJson(result)).toEqual({ steppedTo: { sec: 5, nsec: 100000000, seconds: 5.1 } });
  });

  it("reports a renderer error reply as a tool error with the message", async () => {
    sendCommand.mockResolvedValue({ ok: false, error: "data source does not support playback control" });
    const result = await callTool(makeTools().get("play")!);
    expect(result.isError).toEqual(true);
    expect(result.content[0]!.text).toEqual("data source does not support playback control");
  });

  it("reports a non-object renderer reply as an internal error", async () => {
    for (const reply of [undefined, "nope", 42]) {
      sendCommand.mockResolvedValue(reply);
      const result = await callTool(makeTools().get("pause")!);
      expect(result.isError).toEqual(true);
      expect(result.content[0]!.text).toContain("internal error");
    }
  });

  it("reports a failed command dispatch (timeout / no window) as a tool error", async () => {
    sendCommand.mockRejectedValue(new Error('MCP command "playback.play" timed out'));
    const result = await callTool(makeTools().get("play")!);
    expect(result.isError).toEqual(true);
    expect(result.content[0]!.text).toContain("timed out");
  });
});

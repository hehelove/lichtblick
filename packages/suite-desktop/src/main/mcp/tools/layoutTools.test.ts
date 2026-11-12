// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { registerLayoutTools } from "./layoutTools";

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
  registerLayoutTools(fakeMcp as unknown as Parameters<typeof registerLayoutTools>[0], {
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

const LAYOUT_DATA = {
  configById: {},
  globalVariables: {},
  playbackConfig: { speed: 1 },
  version: 1,
};

describe("mcp layout tools", () => {
  beforeEach(() => {
    sendCommand.mockReset();
  });

  it("registers the three layout tools with honest annotations", () => {
    const tools = makeTools();
    expect([...tools.keys()].sort()).toEqual(["get_layout", "list_layouts", "load_layout"]);

    expect(tools.get("list_layouts")!.annotations?.readOnlyHint).toEqual(true);
    expect(tools.get("get_layout")!.annotations?.readOnlyHint).toEqual(true);

    // Loading a layout replaces the current workspace layout — destructive, not idempotent.
    const load = tools.get("load_layout")!;
    expect(load.annotations?.readOnlyHint).toEqual(false);
    expect(load.annotations?.destructiveHint).toEqual(true);
    expect(load.annotations?.idempotentHint).toEqual(false);
  });

  it("list_layouts sends the command and unwraps a successful reply", async () => {
    sendCommand.mockResolvedValue({
      ok: true,
      value: { layouts: [{ id: "layout-1", name: "Foo", updatedAt: "2026-01-02T03:04:05.000Z" }] },
    });

    const result = await callTool(makeTools().get("list_layouts")!);

    expect(sendCommand).toHaveBeenCalledWith("layout.list_layouts", {});
    expect(result.isError).toEqual(undefined);
    expect(parseJson(result)).toEqual({
      layouts: [{ id: "layout-1", name: "Foo", updatedAt: "2026-01-02T03:04:05.000Z" }],
    });
  });

  it("get_layout requires a name and forwards it", async () => {
    const tools = makeTools();
    const shape = tools.get("get_layout")!.inputSchema ?? {};
    expect(Object.keys(shape).sort()).toEqual(["name"]);
    const name = shape["name"] as { safeParse: (v: unknown) => { success: boolean } };
    expect(name.safeParse("Foo").success).toEqual(true);
    expect(name.safeParse(undefined).success).toEqual(false); // required
    expect(name.safeParse(42).success).toEqual(false);

    sendCommand.mockResolvedValue({ ok: true, value: LAYOUT_DATA });
    const result = await callTool(tools.get("get_layout")!, { name: "Foo" });

    expect(sendCommand).toHaveBeenCalledWith("layout.get_layout", { name: "Foo" });
    expect(parseJson(result)).toEqual(LAYOUT_DATA);
  });

  it("get_layout reports a not-found renderer reply as a tool error", async () => {
    sendCommand.mockResolvedValue({ ok: false, error: "layout not found: Foo" });
    const result = await callTool(makeTools().get("get_layout")!, { name: "Foo" });
    expect(result.isError).toEqual(true);
    expect(result.content[0]!.text).toEqual("layout not found: Foo");
  });

  it("load_layout accepts a name or a layout_json string/object and forwards the payload", async () => {
    const tools = makeTools();
    const shape = tools.get("load_layout")!.inputSchema ?? {};
    expect(Object.keys(shape).sort()).toEqual(["layout_json", "name"]);
    const name = shape["name"] as { safeParse: (v: unknown) => { success: boolean } };
    expect(name.safeParse(undefined).success).toEqual(true); // optional
    const layoutJson = shape["layout_json"] as { safeParse: (v: unknown) => { success: boolean } };
    expect(layoutJson.safeParse(undefined).success).toEqual(true); // optional
    expect(layoutJson.safeParse('{"version": 1}').success).toEqual(true);
    expect(layoutJson.safeParse(LAYOUT_DATA).success).toEqual(true);
    expect(layoutJson.safeParse(42).success).toEqual(false);

    sendCommand.mockResolvedValue({ ok: true, value: { id: "layout-2", name: "Foo" } });
    const byName = await callTool(tools.get("load_layout")!, { name: "Foo" });
    expect(sendCommand).toHaveBeenCalledWith("layout.load_layout", { name: "Foo", layout_json: undefined });
    expect(parseJson(byName)).toEqual({ id: "layout-2", name: "Foo" });

    sendCommand.mockResolvedValue({ ok: true, value: { id: "layout-3", name: "imported" } });
    await callTool(tools.get("load_layout")!, { layout_json: JSON.stringify(LAYOUT_DATA) });
    expect(sendCommand).toHaveBeenLastCalledWith("layout.load_layout", {
      name: undefined,
      layout_json: JSON.stringify(LAYOUT_DATA),
    });
  });

  it("load_layout errors without dispatching when both or neither parameter is provided", async () => {
    const tool = makeTools().get("load_layout")!;
    for (const args of [
      { name: "Foo", layout_json: JSON.stringify(LAYOUT_DATA) },
      {},
      { name: undefined, layout_json: undefined },
    ]) {
      const result = await callTool(tool, args);
      expect(result.isError).toEqual(true);
      expect(result.content[0]!.text).toEqual("provide exactly one of name or layout_json");
    }
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("reports a renderer error reply as a tool error with the message", async () => {
    sendCommand.mockResolvedValue({ ok: false, error: 'missing or invalid fields: "configById"' });
    const result = await callTool(makeTools().get("load_layout")!, { name: "Foo" });
    expect(result.isError).toEqual(true);
    expect(result.content[0]!.text).toEqual('missing or invalid fields: "configById"');
  });

  it("reports a non-object renderer reply as an internal error", async () => {
    for (const reply of [undefined, "nope", 42]) {
      sendCommand.mockResolvedValue(reply);
      const result = await callTool(makeTools().get("list_layouts")!);
      expect(result.isError).toEqual(true);
      expect(result.content[0]!.text).toContain("internal error");
    }
  });

  it("reports a failed command dispatch (timeout / no window) as a tool error", async () => {
    sendCommand.mockRejectedValue(new Error('MCP command "layout.list_layouts" timed out'));
    const result = await callTool(makeTools().get("list_layouts")!);
    expect(result.isError).toEqual(true);
    expect(result.content[0]!.text).toContain("timed out");
  });
});

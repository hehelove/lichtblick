// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { registerScriptTools } from "./scriptTools";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type RegisteredTool = {
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  description?: string;
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
  registerScriptTools(fakeMcp as unknown as Parameters<typeof registerScriptTools>[0], {
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

function schemaOf(tool: RegisteredTool, key: string): { safeParse: (v: unknown) => { success: boolean } } {
  return (tool.inputSchema ?? {})[key] as { safeParse: (v: unknown) => { success: boolean } };
}

describe("mcp script tools", () => {
  beforeEach(() => {
    sendCommand.mockReset();
  });

  it("registers the five user script tools with honest annotations", () => {
    const tools = makeTools();
    expect([...tools.keys()].sort()).toEqual([
      "user_script_delete",
      "user_script_get",
      "user_script_list",
      "user_script_put",
      "user_script_run",
    ]);

    expect(tools.get("user_script_list")!.annotations?.readOnlyHint).toEqual(true);
    expect(tools.get("user_script_get")!.annotations?.readOnlyHint).toEqual(true);

    const put = tools.get("user_script_put")!;
    expect(put.annotations?.readOnlyHint).toEqual(false);
    expect(put.annotations?.destructiveHint).toEqual(true);
    expect(put.annotations?.idempotentHint).toEqual(false); // no-id create allocates per call

    const del = tools.get("user_script_delete")!;
    expect(del.annotations?.readOnlyHint).toEqual(false);
    expect(del.annotations?.destructiveHint).toEqual(true);
    expect(del.annotations?.idempotentHint).toEqual(false); // second delete errors

    const run = tools.get("user_script_run")!;
    expect(run.annotations?.readOnlyHint).toEqual(false);
    expect(run.annotations?.destructiveHint).toEqual(true);
    expect(run.annotations?.idempotentHint).toEqual(false);
  });

  it("user_script_run description states the file-source boundary and message-stream output", () => {
    const description = makeTools().get("user_script_run")!.description ?? "";
    expect(description).toMatch(/live data sources do not support batch script runs/i);
    expect(description).toMatch(/message/i);
  });

  it("user_script_run validates sourceCode/name/maxMessages with a default of 100", () => {
    const tool = makeTools().get("user_script_run")!;
    expect(Object.keys(tool.inputSchema ?? {}).sort()).toEqual(["maxMessages", "name", "sourceCode"]);
    const sourceCode = schemaOf(tool, "sourceCode");
    expect(sourceCode.safeParse("// x").success).toEqual(true);
    expect(sourceCode.safeParse("").success).toEqual(false);
    expect(sourceCode.safeParse(undefined).success).toEqual(false);
    const name = schemaOf(tool, "name");
    expect(name.safeParse(undefined).success).toEqual(true); // optional
    expect(name.safeParse(42).success).toEqual(false);
    const maxMessages = schemaOf(tool, "maxMessages") as {
      safeParse: (v: unknown) => { success: boolean; data?: unknown };
    };
    expect(maxMessages.safeParse(undefined)).toEqual(
      expect.objectContaining({ success: true, data: 100 }),
    );
    expect(maxMessages.safeParse(0).success).toEqual(false);
    expect(maxMessages.safeParse(1.5).success).toEqual(false);
    expect(maxMessages.safeParse("5").success).toEqual(false);
  });

  it("user_script_run forwards with a 120s dispatch timeout and unwraps the reply", async () => {
    sendCommand.mockResolvedValue({
      ok: true,
      value: { outputTopic: "/out", schemaName: "script", count: 1, messages: [], logs: [] },
    });
    const result = await callTool(makeTools().get("user_script_run")!, { sourceCode: "// x" });
    // The only tool overriding the 60s dispatch default: script runs poll and batch-collect.
    expect(sendCommand).toHaveBeenCalledWith(
      "script.run",
      { sourceCode: "// x", name: undefined, maxMessages: 100 },
      { timeoutMs: 120_000 },
    );
    expect(result.isError).toEqual(undefined);
    expect(parseJson(result)).toEqual({
      outputTopic: "/out",
      schemaName: "script",
      count: 1,
      messages: [],
      logs: [],
    });
  });

  it("user_script_run forwards an explicit name and maxMessages", async () => {
    sendCommand.mockResolvedValue({ ok: true, value: { count: 0 } });
    await callTool(makeTools().get("user_script_run")!, {
      sourceCode: "// x",
      name: "Foo",
      maxMessages: 3,
    });
    expect(sendCommand).toHaveBeenCalledWith(
      "script.run",
      { sourceCode: "// x", name: "Foo", maxMessages: 3 },
      { timeoutMs: 120_000 },
    );
  });

  it("user_script_run reports a failed renderer run as a tool error", async () => {
    sendCommand.mockResolvedValue({ ok: false, error: "live data sources do not support batch script runs" });
    const result = await callTool(makeTools().get("user_script_run")!, { sourceCode: "// x" });
    expect(result.isError).toEqual(true);
    expect(result.content[0]!.text).toEqual("live data sources do not support batch script runs");
  });

  it("descriptions state layout persistence and auto-rerun semantics", () => {
    const tools = makeTools();
    const description = tools.get("user_script_put")!.description ?? "";
    expect(description).toMatch(/persist/i);
    expect(description).toMatch(/layout/i);
    expect(description).toMatch(/re-?run/i);
  });

  it("user_script_list sends the command and unwraps a successful reply", async () => {
    sendCommand.mockResolvedValue({
      ok: true,
      value: { scripts: [{ id: "mcp-script-1", name: "Foo" }] },
    });

    const result = await callTool(makeTools().get("user_script_list")!);

    expect(sendCommand).toHaveBeenCalledWith("script.list", {});
    expect(result.isError).toEqual(undefined);
    expect(parseJson(result)).toEqual({ scripts: [{ id: "mcp-script-1", name: "Foo" }] });
  });

  it("user_script_get requires an id string and forwards it", async () => {
    const tools = makeTools();
    const tool = tools.get("user_script_get")!;
    expect(Object.keys(tool.inputSchema ?? {}).sort()).toEqual(["id"]);
    const id = schemaOf(tool, "id");
    expect(id.safeParse("mcp-script-1").success).toEqual(true);
    expect(id.safeParse(undefined).success).toEqual(false); // required
    expect(id.safeParse(42).success).toEqual(false);

    sendCommand.mockResolvedValue({ ok: true, value: { name: "Foo", sourceCode: "// x" } });
    const result = await callTool(tool, { id: "mcp-script-1" });

    expect(sendCommand).toHaveBeenCalledWith("script.get", { id: "mcp-script-1" });
    expect(parseJson(result)).toEqual({ name: "Foo", sourceCode: "// x" });
  });

  it("user_script_get reports a not-found renderer reply as a tool error", async () => {
    sendCommand.mockResolvedValue({ ok: false, error: "user script not found: mcp-script-9" });
    const result = await callTool(makeTools().get("user_script_get")!, { id: "mcp-script-9" });
    expect(result.isError).toEqual(true);
    expect(result.content[0]!.text).toEqual("user script not found: mcp-script-9");
  });

  it("user_script_put validates non-empty name/sourceCode and optional id, and forwards", async () => {
    const tools = makeTools();
    const tool = tools.get("user_script_put")!;
    expect(Object.keys(tool.inputSchema ?? {}).sort()).toEqual(["id", "name", "sourceCode"]);
    const name = schemaOf(tool, "name");
    expect(name.safeParse("Foo").success).toEqual(true);
    expect(name.safeParse("").success).toEqual(false); // min(1)
    expect(name.safeParse(undefined).success).toEqual(false);
    const sourceCode = schemaOf(tool, "sourceCode");
    expect(sourceCode.safeParse("// x").success).toEqual(true);
    expect(sourceCode.safeParse("").success).toEqual(false);
    const id = schemaOf(tool, "id");
    expect(id.safeParse(undefined).success).toEqual(true); // optional
    expect(id.safeParse(42).success).toEqual(false);

    sendCommand.mockResolvedValue({ ok: true, value: { id: "mcp-script-1", name: "Foo", created: true } });
    const result = await callTool(tool, { name: "Foo", sourceCode: "// x" });
    expect(sendCommand).toHaveBeenCalledWith("script.put", {
      name: "Foo",
      sourceCode: "// x",
      id: undefined,
    });
    expect(parseJson(result)).toEqual({ id: "mcp-script-1", name: "Foo", created: true });
  });

  it("user_script_delete requires an id and forwards it", async () => {
    const tools = makeTools();
    const tool = tools.get("user_script_delete")!;
    expect(Object.keys(tool.inputSchema ?? {}).sort()).toEqual(["id"]);
    const id = schemaOf(tool, "id");
    expect(id.safeParse(undefined).success).toEqual(false);
    expect(id.safeParse(42).success).toEqual(false);

    sendCommand.mockResolvedValue({ ok: true, value: { id: "mcp-script-1", deleted: true } });
    const result = await callTool(tool, { id: "mcp-script-1" });
    expect(sendCommand).toHaveBeenCalledWith("script.delete", { id: "mcp-script-1" });
    expect(parseJson(result)).toEqual({ id: "mcp-script-1", deleted: true });
  });

  it("user_script_delete reports a not-found renderer reply as a tool error", async () => {
    sendCommand.mockResolvedValue({ ok: false, error: "user script not found: nope" });
    const result = await callTool(makeTools().get("user_script_delete")!, { id: "nope" });
    expect(result.isError).toEqual(true);
    expect(result.content[0]!.text).toEqual("user script not found: nope");
  });

  it("reports a non-object renderer reply as an internal error", async () => {
    for (const reply of [undefined, "nope", 42]) {
      sendCommand.mockResolvedValue(reply);
      const result = await callTool(makeTools().get("user_script_list")!);
      expect(result.isError).toEqual(true);
      expect(result.content[0]!.text).toContain("internal error");
    }
  });

  it("reports a failed command dispatch (timeout / no window) as a tool error", async () => {
    sendCommand.mockRejectedValue(new Error('MCP command "script.list" timed out'));
    const result = await callTool(makeTools().get("user_script_list")!);
    expect(result.isError).toEqual(true);
    expect(result.content[0]!.text).toContain("timed out");
  });
});

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.


import { registerDataTools } from "./dataTools";
import type { McpStateSnapshot } from "../../../common/types";


type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type RegisteredTool = {
  annotations?: { readOnlyHint?: boolean };
  inputSchema?: Record<string, unknown>;
  cb: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
};

function makeTools(snapshot: McpStateSnapshot): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const fakeMcp = {
    registerTool: (
      name: string,
      config: { annotations?: RegisteredTool["annotations"]; inputSchema?: RegisteredTool["inputSchema"] },
      cb: RegisteredTool["cb"],
    ) => {
      tools.set(name, { ...config, cb });
    },
  };
  registerDataTools(fakeMcp as unknown as Parameters<typeof registerDataTools>[0], {
    getState: () => snapshot,
  });
  return tools;
}

async function callTool(
  tool: RegisteredTool,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  return await tool.cb(args);
}

function parseJson(result: ToolResult): unknown {
  expect(result.content).toHaveLength(1);
  expect(result.content[0]!.type).toEqual("text");
  return JSON.parse(result.content[0]!.text) as unknown;
}

const EMPTY_SNAPSHOT: McpStateSnapshot = {
  presence: "NOT_PRESENT",
  playerName: undefined,
  topics: [],
  datatypes: {},
};

const POPULATED_SNAPSHOT: McpStateSnapshot = {
  presence: "PRESENT",
  playerName: "rosbridge",
  topics: [
    { name: "/tf", schemaName: "geometry_msgs/msg/TransformStamped" },
    { name: "/alias", schemaName: "std_msgs/String", aliasedFromName: "/orig" },
  ],
  datatypes: {
    "std_msgs/String": {
      name: "std_msgs/String",
      definitions: [{ name: "data", type: "string" }],
    },
  },
};

describe("mcp data tools", () => {
  it("registers the three tools as read-only", () => {
    const tools = makeTools(EMPTY_SNAPSHOT);
    expect([...tools.keys()].sort()).toEqual(["get_data_source_info", "get_schema", "list_topics"]);
    for (const tool of tools.values()) {
      expect(tool.annotations?.readOnlyHint).toEqual(true);
    }
  });

  it("get_schema declares a required string schemaName input", () => {
    const tools = makeTools(EMPTY_SNAPSHOT);
    const shape = tools.get("get_schema")!.inputSchema ?? {};
    expect(Object.keys(shape)).toEqual(["schemaName"]);
    const schemaName = shape["schemaName"] as { safeParse: (v: unknown) => { success: boolean } };
    expect(schemaName.safeParse("std_msgs/String").success).toEqual(true);
    expect(schemaName.safeParse(123).success).toEqual(false);
    expect(schemaName.safeParse(undefined).success).toEqual(false); // required, not optional
  });

  it("list_topics returns an empty list for an empty snapshot and never throws", async () => {
    const tools = makeTools(EMPTY_SNAPSHOT);
    const result = await callTool(tools.get("list_topics")!);
    expect(result.isError).toEqual(undefined);
    expect(parseJson(result)).toEqual({ topics: [], presence: "NOT_PRESENT" });
  });

  it("list_topics returns the snapshot topics with presence and player name", async () => {
    const tools = makeTools(POPULATED_SNAPSHOT);
    const result = await callTool(tools.get("list_topics")!);
    expect(parseJson(result)).toEqual({
      topics: POPULATED_SNAPSHOT.topics,
      presence: "PRESENT",
      playerName: "rosbridge",
    });
  });

  it("get_schema returns the full datatype definition on a hit", async () => {
    const tools = makeTools(POPULATED_SNAPSHOT);
    const result = await callTool(tools.get("get_schema")!, { schemaName: "std_msgs/String" });
    expect(parseJson(result)).toEqual(POPULATED_SNAPSHOT.datatypes["std_msgs/String"]);
  });

  it("get_schema reports a tool error when the schema is not found", async () => {
    const tools = makeTools(POPULATED_SNAPSHOT);
    const result = await callTool(tools.get("get_schema")!, { schemaName: "nope/Nope" });
    expect(result.isError).toEqual(true);
    expect(result.content[0]!.text).toContain("schema not found");
  });

  it("get_data_source_info summarizes the loaded snapshot", async () => {
    const tools = makeTools(POPULATED_SNAPSHOT);
    const result = await callTool(tools.get("get_data_source_info")!);
    expect(parseJson(result)).toEqual({
      presence: "PRESENT",
      playerName: "rosbridge",
      topicCount: 2,
      datatypeCount: 1,
    });
  });

  it("get_data_source_info reports zero counts for an empty snapshot", async () => {
    const tools = makeTools(EMPTY_SNAPSHOT);
    const result = await callTool(tools.get("get_data_source_info")!);
    expect(parseJson(result)).toEqual({
      presence: "NOT_PRESENT",
      topicCount: 0,
      datatypeCount: 0,
    });
  });
});

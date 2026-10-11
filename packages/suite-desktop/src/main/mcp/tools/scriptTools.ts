// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { z } from "zod";

import type { McpServer } from "../McpServer";

export type ScriptToolDeps = {
  sendCommand: (
    type: string,
    payload: unknown,
    opts?: { timeoutMs?: number },
  ) => Promise<unknown>;
};

function textResult(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  // bigint payloads (e.g. ROS2 fields) are not JSON-representable; stringify them like JSON.stringify would fail.
  const text = JSON.stringify(value, (_key, val: unknown) =>
    typeof val === "bigint" ? val.toString() : val,
  );
  return { content: [{ type: "text", text: text ?? "" }] };
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
 * Registers the user script tools. Each tool forwards a `"script.*"` command to the focused window
 * via the injected sendCommand (the mcp dispatch module) and unwraps the renderer's reply. Pure:
 * no electron imports — the collaborator is injected.
 */
export function registerScriptTools(
  mcp: Pick<McpServer, "registerTool">,
  deps: ScriptToolDeps,
): void {
  async function run(type: string, payload: unknown, opts?: { timeoutMs?: number }) {
    try {
      const reply =
        opts == undefined
          ? await deps.sendCommand(type, payload)
          : await deps.sendCommand(type, payload, opts);
      return commandResult(reply);
    } catch (err) {
      // Dispatch failures (no window, timeout) are tool-level outcomes, not server failures.
      return {
        content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  }

  mcp.registerTool(
    "user_script_list",
    {
      title: "List user scripts",
      description:
        "List the user scripts in the focused Studio window's current layout as {scripts: [{id, name}]}. Scripts persist into the layout and re-run automatically whenever their source or config changes",
      annotations: { readOnlyHint: true },
    },
    async () => await run("script.list", {}),
  );

  mcp.registerTool(
    "user_script_get",
    {
      title: "Get user script",
      description:
        "Get the name and source code of a user script in the current layout by its id. Scripts persist into the layout and re-run automatically whenever their source or config changes",
      inputSchema: { id: z.string().describe("Id of the user script (from user_script_list)") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => await run("script.get", { id }),
  );

  mcp.registerTool(
    "user_script_put",
    {
      title: "Create or update user script",
      description:
        "Create or update a user script in the focused Studio window's current layout. Without an id, a new script is created with an allocated id (returned as {id, name, created}). With an id, that script is overwritten. The script persists into the layout and re-runs automatically after the change",
      inputSchema: {
        name: z.string().min(1).describe("Display name of the script"),
        sourceCode: z.string().min(1).describe("Script source code (TypeScript/JavaScript)"),
        id: z.string().optional().describe("Id of an existing script to overwrite; omit to create"),
      },
      // Overwrite converges, but the no-id create path allocates a fresh script per call.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ name, sourceCode, id }) => await run("script.put", { name, sourceCode, id }),
  );

  mcp.registerTool(
    "user_script_delete",
    {
      title: "Delete user script",
      description:
        "Delete a user script from the focused Studio window's current layout by its id. The deletion persists into the layout. Deleting a nonexistent id is an error, not a silent success",
      inputSchema: { id: z.string().describe("Id of the user script to delete") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ id }) => await run("script.delete", { id }),
  );

  mcp.registerTool(
    "user_script_run",
    {
      title: "Run a user script and read back its output",
      description:
        "Run a user script in the focused Studio window against the current data source and return its output as a message stream: {outputTopic, schemaName, count, messages, logs, diagnostics}. Writes a temporary script into the layout (removed afterwards, but the layout mutates while it runs). Only file-like data sources support batch script runs; live data sources do not support batch script runs",
      inputSchema: {
        sourceCode: z.string().min(1).describe("Script source code (TypeScript/JavaScript)"),
        name: z.string().optional().describe("Display name for the temporary script"),
        maxMessages: z
          .number()
          .int()
          .positive()
          .default(100)
          .describe("Maximum number of output messages to collect"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    // The only tool overriding the 60s dispatch default: the run polls for topic registration and
    // batch-collects the whole file. The ?? mirrors the schema default so direct cb calls agree.
    async ({ sourceCode, name, maxMessages }) =>
      await run(
        "script.run",
        { sourceCode, name, maxMessages: maxMessages ?? 100 },
        { timeoutMs: 120_000 },
      ),
  );
}

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { z } from "zod";

import type { McpServer } from "../McpServer";

export type LayoutToolDeps = {
  sendCommand: (type: string, payload: unknown) => Promise<unknown>;
};

const layoutJsonSchema = z
  .union([z.string(), z.record(z.string(), z.unknown())])
  .describe("Layout JSON as a string or an already-parsed object (configById/globalVariables/playbackConfig/...)");

function textResult(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text", text: JSON.stringify(value) ?? "" }] };
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
 * Registers the layout tools. Each tool forwards a `"layout.*"` command to the focused window via
 * the injected sendCommand (the mcp dispatch module) and unwraps the renderer's reply. Pure: no
 * electron imports — the collaborator is injected.
 */
export function registerLayoutTools(
  mcp: Pick<McpServer, "registerTool">,
  deps: LayoutToolDeps,
): void {
  async function run(type: string, payload: unknown) {
    try {
      return commandResult(await deps.sendCommand(type, payload));
    } catch (err) {
      // Dispatch failures (no window, timeout) are tool-level outcomes, not server failures.
      return {
        content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  }

  mcp.registerTool(
    "list_layouts",
    {
      title: "List layouts",
      description:
        "List the saved layouts in the focused Studio window as {layouts: [{id, name, updatedAt}]}",
      annotations: { readOnlyHint: true },
    },
    async () => await run("layout.list_layouts", {}),
  );

  mcp.registerTool(
    "get_layout",
    {
      title: "Get layout",
      description:
        "Get the full JSON of a saved layout (configById, layout mosaic, userNodes, version) from the focused Studio window by its exact name",
      inputSchema: { name: z.string().describe("Exact name of the layout to fetch") },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => await run("layout.get_layout", { name }),
  );

  mcp.registerTool(
    "load_layout",
    {
      title: "Load layout",
      description:
        'Load a layout in the focused Studio window, replacing the current workspace layout. Pass exactly one of: "name" of an existing saved layout, or "layout_json" (a layout JSON string or object) to validate and install as a new layout',
      inputSchema: {
        name: z.string().optional().describe("Exact name of a saved layout to select"),
        layout_json: layoutJsonSchema.optional(),
      },
      // Loading replaces the current layout's workspace state.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ name, layout_json }) => {
      if ((name == undefined) === (layout_json == undefined)) {
        return {
          content: [{ type: "text" as const, text: "provide exactly one of name or layout_json" }],
          isError: true,
        };
      }
      return await run("layout.load_layout", { name, layout_json });
    },
  );
}

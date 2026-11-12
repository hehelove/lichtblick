// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { z } from "zod";

import type { McpStateSnapshot } from "../../../common/types";
import type { McpServer } from "../McpServer";

export type DataToolDeps = {
  getState: () => McpStateSnapshot;
};

function textResult(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text", text: JSON.stringify(value) ?? "" }] };
}

/**
 * Registers the read-only data tools over the state snapshot cached by the mcp
 * dispatch module. Pure: no electron imports — both collaborators are injected.
 */
export function registerDataTools(mcp: Pick<McpServer, "registerTool">, deps: DataToolDeps): void {
  mcp.registerTool(
    "list_topics",
    {
      title: "List topics",
      description: "List the topics available in the currently focused Studio window",
      annotations: { readOnlyHint: true },
    },
    () => {
      const { topics, presence, playerName } = deps.getState();
      return textResult({ topics, presence, playerName });
    },
  );

  mcp.registerTool(
    "get_schema",
    {
      title: "Get schema",
      description: "Get the full datatype definition for a schema name",
      inputSchema: { schemaName: z.string().describe("Schema name, e.g. std_msgs/String") },
      annotations: { readOnlyHint: true },
    },
    ({ schemaName }) => {
      const definition = deps.getState().datatypes[schemaName];
      if (definition == undefined) {
        // A missing schema is a domain-level outcome, not a server failure: report it as a
        // tool error (isError) rather than throwing.
        return {
          content: [{ type: "text" as const, text: `schema not found: ${schemaName}` }],
          isError: true,
        };
      }
      return textResult(definition);
    },
  );

  mcp.registerTool(
    "get_data_source_info",
    {
      title: "Get data source info",
      description: "Summary of the data source loaded in the focused Studio window",
      annotations: { readOnlyHint: true },
    },
    () => {
      const { presence, playerName, topics, datatypes } = deps.getState();
      return textResult({
        presence,
        playerName,
        topicCount: topics.length,
        datatypeCount: Object.keys(datatypes).length,
      });
    },
  );
}

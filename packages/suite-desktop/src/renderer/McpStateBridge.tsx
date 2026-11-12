// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect } from "react";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/src/components/MessagePipeline";

import { Desktop } from "../common/types";

const selectPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
const selectPlayerName = (ctx: MessagePipelineContext) => ctx.playerState.name;
const selectSortedTopics = (ctx: MessagePipelineContext) => ctx.sortedTopics;
const selectDatatypes = (ctx: MessagePipelineContext) => ctx.datatypes;

/**
 * McpStateBridge pushes a snapshot of the current player state to the main process whenever the
 * pipeline's presence, player name, topics, or datatypes references change. The main process
 * serves the latest snapshot to MCP tools.
 */
export default function McpStateBridge(): React.JSX.Element | null {
  const desktopBridge = (global as unknown as { desktopBridge?: Desktop }).desktopBridge;
  const presence = useMessagePipeline(selectPresence);
  const playerName = useMessagePipeline(selectPlayerName);
  const sortedTopics = useMessagePipeline(selectSortedTopics);
  const datatypes = useMessagePipeline(selectDatatypes);

  useEffect(() => {
    if (desktopBridge == undefined) {
      return;
    }
    desktopBridge.sendMcpStateSnapshot({
      presence,
      playerName,
      topics: sortedTopics.map((topic) => ({
        name: topic.name,
        schemaName: topic.schemaName,
        aliasedFromName: topic.aliasedFromName,
      })),
      datatypes: Object.fromEntries(datatypes),
    });
  }, [desktopBridge, presence, playerName, sortedTopics, datatypes]);

  if (desktopBridge == undefined) {
    return null;
  }
  return <></>;
}

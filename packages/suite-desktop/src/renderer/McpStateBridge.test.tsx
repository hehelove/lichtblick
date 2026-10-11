/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render } from "@testing-library/react";

import MockMessagePipelineProvider from "@lichtblick/suite-base/src/components/MessagePipeline/MockMessagePipelineProvider";
import { PlayerPresence } from "@lichtblick/suite-base/src/players/types";

import McpStateBridge from "./McpStateBridge";
import { Desktop } from "../common/types";

const sendMcpStateSnapshot = jest.fn();
const mockBridge = { sendMcpStateSnapshot } as unknown as Desktop;
const globalWithBridge = global as unknown as { desktopBridge?: Desktop };

describe("McpStateBridge", () => {
  beforeEach(() => {
    sendMcpStateSnapshot.mockClear();
    globalWithBridge.desktopBridge = mockBridge;
  });

  afterEach(() => {
    delete globalWithBridge.desktopBridge;
  });

  const datatypes = new Map([["std_msgs/String", { definitions: [] }]]);

  const renderBridge = (topics: { name: string; schemaName: string | undefined }[]) =>
    render(
      <MockMessagePipelineProvider
        presence={PlayerPresence.PRESENT}
        name="mock-player"
        topics={topics}
        datatypes={datatypes}
      >
        <McpStateBridge />
      </MockMessagePipelineProvider>,
    );

  it("pushes a snapshot on mount and again when the topics reference changes", () => {
    const topicsA = [{ name: "/a", schemaName: "std_msgs/String" }];
    const topicsB = [
      { name: "/a", schemaName: "std_msgs/String" },
      { name: "/b", schemaName: undefined },
    ];
    const { rerender } = renderBridge(topicsA);

    expect(sendMcpStateSnapshot).toHaveBeenCalledTimes(1);
    expect(sendMcpStateSnapshot).toHaveBeenLastCalledWith({
      presence: PlayerPresence.PRESENT,
      playerName: "mock-player",
      topics: [{ name: "/a", schemaName: "std_msgs/String", aliasedFromName: undefined }],
      datatypes: { "std_msgs/String": { definitions: [] } },
    });

    rerender(
      <MockMessagePipelineProvider
        presence={PlayerPresence.PRESENT}
        name="mock-player"
        topics={topicsB}
        datatypes={datatypes}
      >
        <McpStateBridge />
      </MockMessagePipelineProvider>,
    );

    expect(sendMcpStateSnapshot).toHaveBeenCalledTimes(2);
    expect(sendMcpStateSnapshot).toHaveBeenLastCalledWith({
      presence: PlayerPresence.PRESENT,
      playerName: "mock-player",
      topics: [
        { name: "/a", schemaName: "std_msgs/String", aliasedFromName: undefined },
        { name: "/b", schemaName: undefined, aliasedFromName: undefined },
      ],
      datatypes: { "std_msgs/String": { definitions: [] } },
    });
  });

  it("does not push again when the pipeline references are unchanged", () => {
    const topics = [{ name: "/a", schemaName: "std_msgs/String" }];
    const { rerender } = renderBridge(topics);

    rerender(
      <MockMessagePipelineProvider
        presence={PlayerPresence.PRESENT}
        name="mock-player"
        topics={topics}
        datatypes={datatypes}
      >
        <McpStateBridge />
      </MockMessagePipelineProvider>,
    );

    expect(sendMcpStateSnapshot).toHaveBeenCalledTimes(1);
  });

  it("renders nothing and pushes nothing without a desktop bridge (web)", () => {
    delete globalWithBridge.desktopBridge;

    const { container } = renderBridge([]);
    expect(container.childElementCount).toEqual(0);
    expect(sendMcpStateSnapshot).not.toHaveBeenCalled();
  });
});

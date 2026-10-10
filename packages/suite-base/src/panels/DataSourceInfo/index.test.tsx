/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";

import { Metadata } from "@lichtblick/suite";

jest.mock("@lichtblick/suite-base/components/Panel", () => ({
  __esModule: true,
  default: (Component: React.ComponentType) =>
    Object.assign(Component, { panelType: "SourceInfo", defaultConfig: {} }),
}));

jest.mock("@lichtblick/suite-base/components/PanelToolbar", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-toolbar" />,
}));

jest.mock("@lichtblick/suite-base/components/DirectTopicStatsUpdater", () => ({
  DirectTopicStatsUpdater: () => <div data-testid="topic-stats" />,
}));

let mockMetadata: readonly Metadata[] = [];

jest.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  useMessagePipeline: (selector: (ctx: unknown) => unknown) =>
    selector({
      sortedTopics: [{ name: "/map", schemaName: "nav_msgs/OccupancyGrid" }],
      playerState: {
        activeData: { startTime: { sec: 0, nsec: 0 }, endTime: { sec: 10, nsec: 0 } },
      },
      getMetadata: () => mockMetadata,
    }),
}));

import DataSourceInfoPanel from "./index";

describe("DataSourceInfoPanel", () => {
  it("shows metadata records with name and JSON fields", () => {
    mockMetadata = [
      { name: "metadata1", metadata: { key: "value" } },
      { name: "metadata2", metadata: { another: "entry", count: "2" } },
    ];

    render(<DataSourceInfoPanel />);

    expect(screen.getByText("Metadata records")).toBeInTheDocument();
    expect(screen.getByText("metadata1")).toBeInTheDocument();
    expect(screen.getByText(JSON.stringify({ key: "value" }))).toBeInTheDocument();
    expect(screen.getByText("metadata2")).toBeInTheDocument();
    expect(
      screen.getByText(JSON.stringify({ another: "entry", count: "2" })),
    ).toBeInTheDocument();
  });

  it("hides the metadata section when there are no metadata records", () => {
    mockMetadata = [];

    render(<DataSourceInfoPanel />);

    expect(screen.queryByText("Metadata records")).not.toBeInTheDocument();
  });
});

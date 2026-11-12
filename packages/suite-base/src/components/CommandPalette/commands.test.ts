// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { PanelInfo } from "@lichtblick/suite-base/context/PanelCatalogContext";
import { Layout } from "@lichtblick/suite-base/services/ILayoutStorage";

import { buildCommands } from "./commands";

function makeMockActions() {
  return {
    addPanel: jest.fn(),
    onSelectLayout: jest.fn(),
    openDataSourceDialog: jest.fn(),
    openPreferences: jest.fn(),
    toggleLeftSidebar: jest.fn(),
    toggleRightSidebar: jest.fn(),
    openLayoutBrowser: jest.fn(),
  };
}

describe("buildCommands", () => {
  it("builds panel/layout/view commands with unique ids", () => {
    const commands = buildCommands({
      panels: [
        { title: "Plot", type: "Plot" },
        { title: "Map", type: "Map" },
      ] as PanelInfo[],
      layouts: [{ id: "id-1", name: "My Layout" }] as Layout[],
      actions: makeMockActions(),
    });
    expect(commands.filter((c) => c.group === "Panel")).toHaveLength(2);
    expect(commands.filter((c) => c.group === "Layout")).toHaveLength(1);
    expect(commands.filter((c) => c.group === "View")).toHaveLength(5);
    expect(new Set(commands.map((c) => c.id)).size).toBe(commands.length);
  });

  it("labels panel commands with the panel title and adds the panel on run", () => {
    const actions = makeMockActions();
    const commands = buildCommands({
      panels: [{ title: "Plot", type: "Plot" }] as PanelInfo[],
      layouts: [],
      actions,
    });

    const command = commands.find((c) => c.id === "panel:Plot");
    expect(command).toBeDefined();
    expect(command?.label).toContain("Plot");

    command?.run();
    expect(actions.addPanel).toHaveBeenCalledWith({ type: "Plot" });
  });

  it("selects the layout by id on run", () => {
    const actions = makeMockActions();
    const commands = buildCommands({
      panels: [],
      layouts: [{ id: "id-1", name: "My Layout" }] as Layout[],
      actions,
    });

    commands.find((c) => c.group === "Layout")?.run();
    expect(actions.onSelectLayout).toHaveBeenCalledWith("id-1");
  });
});

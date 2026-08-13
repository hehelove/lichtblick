/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { userEvent } from "@storybook/testing-library";
import { render, screen } from "@testing-library/react";
import { EventEmitter } from "eventemitter3";
import { useMemo } from "react";

import PanelContext from "@lichtblick/suite-base/components/PanelContext";
import { useSelectedPanels } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { BasicBuilder } from "@lichtblick/test-builders";

import { PlotCoordinator } from "./PlotCoordinator";
import { PlotLegend } from "./PlotLegend";

const defaultProps = {
  showLegend: true,
  saveConfig: jest.fn(),
  sidebarDimension: BasicBuilder.number(),
  paths: [],
};

const getContextValue = () => ({
  type: "foo",
  id: "bar",
  title: "Foo Panel",
  config: {},
  saveConfig: jest.fn(),
  updatePanelConfigs: jest.fn(),
  exitFullscreen: jest.fn(),
  setHasFullscreenDescendant: jest.fn(),
  isFullscreen: false,
  connectToolbarDragHandle: jest.fn(),
  setMessagePathDropConfig: jest.fn(),
  openSiblingPanel: jest.fn(),
  replacePanel: jest.fn(),
  enterFullscreen: jest.fn(),
});

const TestWrapper = ({ children }: { children: React.ReactNode }) => {
  const contextValue = useMemo(getContextValue, []);
  return (
    <PanelContext.Provider value={contextValue}>
      <div>{children}</div>
    </PanelContext.Provider>
  );
};

const setup = (overrides = {}) => {
  const props = { ...defaultProps, ...overrides };
  return render(
    <PanelContext.Provider value={getContextValue()}>
      <TestWrapper>
        <PlotLegend
          coordinator={undefined}
          legendDisplay="floating"
          onClickPath={jest.fn()}
          showValues={false}
          {...props}
        />
      </TestWrapper>
    </PanelContext.Provider>,
  );
};

jest.mock("@lichtblick/hooks", () => ({
  useGuaranteedContext: jest.fn(() => ({
    setState: jest.fn(),
    state: {},
  })),
  useSetState: jest.fn(),
  useContext: jest.fn(),
}));

jest.mock("@lichtblick/suite-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutActions: jest.fn(() => ({
    getCurrentLayoutState: jest.fn(),
    setCurrentLayout: jest.fn(),
  })),
  useSelectedPanels: jest.fn(() => []),
}));

describe("PlotLegend", () => {
  const mockSetSelectedPanelIds = jest.fn();
  const path = BasicBuilder.string();
  const secondPath = BasicBuilder.string();

  beforeEach(() => {
    (useSelectedPanels as jest.Mock).mockReturnValue({
      setSelectedPanelIds: mockSetSelectedPanelIds,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders PlotLegend without crashing", () => {
    setup();
    expect(screen.getByTitle("Add series")).toBeDefined();
  });

  it("toggles legend visibility when IconButton is clicked", async () => {
    const mockSaveConfig = jest.fn();
    const { getByRole } = setup({ showLegend: false, saveConfig: mockSaveConfig });

    await userEvent.setup().click(getByRole("button"));

    expect(mockSaveConfig).toHaveBeenCalledWith({ showLegend: true });
  });

  it.each([
    "topLeft",
    "topRight",
    "bottomLeft",
    "bottomRight",
  ] as const)("toggles the legend in the %s corner", async (legendDisplay) => {
    const mockSaveConfig = jest.fn();
    setup({ legendDisplay, saveConfig: mockSaveConfig });

    await userEvent.setup().click(screen.getByRole("button", { name: "Hide legend" }));

    expect(mockSaveConfig).toHaveBeenCalledWith({ showLegend: false });
  });

  it("renders paths from props", () => {
    const paths = [
      { value: path, enabled: true },
      { value: secondPath, enabled: true },
    ];
    setup({ paths });

    expect(screen.getByText(path)).toBeDefined();
    expect(screen.getByText(secondPath)).toBeDefined();
  });

  it("calls onClickPath when a path is clicked", async () => {
    const mockOnClickPath = jest.fn();
    const paths = [{ value: path, enabled: true }];

    setup({ paths, onClickPath: mockOnClickPath });

    await userEvent.setup().click(screen.getByText(path));

    expect(mockOnClickPath).toHaveBeenCalledWith(0);
  });

  it("keeps the dynamic parent editable and toggles children without saving config", async () => {
    const coordinator = new EventEmitter() as PlotCoordinator;
    const setDynamicSeriesEnabled = jest.fn();
    coordinator.setDynamicSeriesEnabled = setDynamicSeriesEnabled;
    const saveConfig = jest.fn();
    setup({
      coordinator,
      saveConfig,
      paths: [{ value: "/foo.values", enabled: true, dynamicLabelField: "label" }],
    });

    coordinator.emit("dynamicSeriesChanged", [
      { identity: "parent:string:a", configIndex: 0, label: "a", color: "red", enabled: true },
    ]);
    expect(screen.getByText("/foo.values")).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete series" })).toBeInTheDocument();
    await screen.findByText("a");
    await userEvent.setup().click(screen.getAllByRole("checkbox")[1]!);

    expect(setDynamicSeriesEnabled).toHaveBeenCalledWith("parent:string:a", {
      enabled: false,
    });
    expect(saveConfig).not.toHaveBeenCalled();
  });
});

/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

import "@testing-library/jest-dom";

import SettingsTreeEditor from "@lichtblick/suite-base/components/SettingsTreeEditor";
import {
  encodeExpansionPath,
  getExpansionStorageKey,
} from "@lichtblick/suite-base/components/SettingsTreeEditor/expansionStorage";
import { SettingsTreeEditorProps } from "@lichtblick/suite-base/components/SettingsTreeEditor/types";
import { useSelectedPanels } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { BasicBuilder } from "@lichtblick/test-builders";

jest.mock("@lichtblick/suite-base/hooks/useGlobalVariables");
jest.mock("@lichtblick/suite-base/context/PanelCatalogContext", () => ({
  usePanelCatalog: () => ({ getPanelByType: jest.fn() }),
}));
jest.mock("@lichtblick/suite-base/context/PanelStateContext");

jest.mock("@lichtblick/suite-base/PanelAPI", () => ({
  useDataSourceInfo: () => ({
    datatypes: new Map(),
    topics: [],
  }),
  useConfigById: jest.fn(() => [{}, jest.fn()]),
}));

jest.mock("@lichtblick/suite-base/context/CurrentLayoutContext", () => ({
  useSelectedPanels: jest.fn(() => ({
    selectedPanelIds: [],
    setSelectedPanelIds: jest.fn(),
  })),
}));

describe("SettingsTreeEditor", () => {
  const mockSetSelectedPanelIds = jest.fn();

  const renderComponent = async (overrides: Partial<SettingsTreeEditorProps> = {}) => {
    const defaultProps: SettingsTreeEditorProps = {
      variant: "panel",
      settings: { actionHandler: jest.fn(), nodes: {} },
      ...overrides,
    };

    const ui: React.ReactElement = (
      <DndProvider backend={HTML5Backend}>
        <SettingsTreeEditor variant={defaultProps.variant} settings={defaultProps.settings} />
      </DndProvider>
    );

    return {
      ...render(ui),
      user: userEvent.setup(),
      props: defaultProps,
    };
  };

  beforeEach(() => {
    localStorage.clear();
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
    (useSelectedPanels as jest.Mock).mockReturnValue({
      selectedPanelIds: [],
      setSelectedPanelIds: mockSetSelectedPanelIds,
    });
    jest.clearAllMocks();
  });

  it("should render SettingsTreeEditor, apply a filter and only show filtered nodes", async () => {
    const nodeLabel = BasicBuilder.string();
    const nodeLabel2 = BasicBuilder.string();

    const { props } = await renderComponent({
      settings: {
        actionHandler: jest.fn(),
        enableFilter: true,
        nodes: { firstNode: { label: nodeLabel }, secondNode: { label: nodeLabel2 } },
      },
    });
    const inputField = screen.getByTestId(`${props.variant}-settings-filter-input`);
    fireEvent.change(inputField, { target: { value: nodeLabel } });

    expect(screen.getByText(nodeLabel)).toBeInTheDocument();
    expect(screen.queryByText(nodeLabel2)).not.toBeInTheDocument();
  });

  it("should filter for something and then clear the filter", async () => {
    const nodeLabel = BasicBuilder.string();

    const { props } = await renderComponent({
      settings: {
        actionHandler: jest.fn(),
        enableFilter: true,
        nodes: { firstNode: { label: nodeLabel } },
      },
    });
    const inputField = screen.getByTestId(`${props.variant}-settings-filter-input`);
    fireEvent.change(inputField, { target: { value: nodeLabel } });

    expect(inputField).toHaveValue(nodeLabel);

    const clearButton = screen.getByTestId("clear-filter-button");
    await userEvent.click(clearButton);

    expect(inputField).toHaveValue("");
  });

  it("restores manually toggled expansion after remounting", async () => {
    (useSelectedPanels as jest.Mock).mockReturnValue({
      selectedPanelIds: ["panel-a"],
      setSelectedPanelIds: mockSetSelectedPanelIds,
    });
    const settings = {
      actionHandler: jest.fn(),
      nodes: {
        root: { label: "Root", children: { child: { label: "Child" } } },
      },
    };

    const firstRender = await renderComponent({ settings });
    expect(screen.getByText("Child")).toBeInTheDocument();
    await firstRender.user.click(screen.getByTestId("settings__nodeHeaderToggle__root"));
    expect(screen.queryByText("Child")).not.toBeInTheDocument();
    firstRender.unmount();

    await renderComponent({ settings });
    expect(screen.queryByText("Child")).not.toBeInTheDocument();
  });

  it("isolates expansion preferences between selected panels", async () => {
    const settings = {
      actionHandler: jest.fn(),
      nodes: {
        root: { label: "Root", children: { child: { label: "Child" } } },
      },
    };
    (useSelectedPanels as jest.Mock).mockReturnValue({
      selectedPanelIds: ["panel-a"],
      setSelectedPanelIds: mockSetSelectedPanelIds,
    });
    const firstRender = await renderComponent({ settings });
    await firstRender.user.click(screen.getByTestId("settings__nodeHeaderToggle__root"));
    firstRender.unmount();

    (useSelectedPanels as jest.Mock).mockReturnValue({
      selectedPanelIds: ["panel-b"],
      setSelectedPanelIds: mockSetSelectedPanelIds,
    });
    await renderComponent({ settings });

    expect(screen.getByText("Child")).toBeInTheDocument();
  });

  it("falls back to each node's default expansion state without a preference", async () => {
    await renderComponent({
      settings: {
        actionHandler: jest.fn(),
        nodes: {
          collapsed: {
            label: "Collapsed",
            defaultExpansionState: "collapsed",
            children: { hidden: { label: "Hidden child" } },
          },
          expanded: {
            label: "Expanded",
            defaultExpansionState: "expanded",
            children: { visible: { label: "Visible child" } },
          },
        },
      },
    });

    expect(screen.queryByText("Hidden child")).not.toBeInTheDocument();
    expect(screen.getByText("Visible child")).toBeInTheDocument();
  });

  it("temporarily expands a focused path without persisting it", async () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem");

    await renderComponent({
      settings: {
        actionHandler: jest.fn(),
        focusedPath: ["root", "child"],
        nodes: {
          root: {
            label: "Root",
            defaultExpansionState: "collapsed",
            children: { child: { label: "Focused child" } },
          },
        },
      },
    });

    expect(screen.getByText("Focused child")).toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("uses complete node paths for nested expansion preferences", async () => {
    (useSelectedPanels as jest.Mock).mockReturnValue({
      selectedPanelIds: ["panel-a"],
      setSelectedPanelIds: mockSetSelectedPanelIds,
    });
    const settings = {
      actionHandler: jest.fn(),
      nodes: {
        first: {
          label: "First",
          children: {
            shared: { label: "First shared", children: { leaf: { label: "First leaf" } } },
          },
        },
        second: {
          label: "Second",
          children: {
            shared: { label: "Second shared", children: { leaf: { label: "Second leaf" } } },
          },
        },
      },
    };

    const { user } = await renderComponent({ settings });
    await user.click(screen.getByTestId("settings__nodeHeaderToggle__first-shared"));

    expect(screen.queryByText("First leaf")).not.toBeInTheDocument();
    expect(screen.getByText("Second leaf")).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(getExpansionStorageKey("panel", "panel-a"))!);
    expect(stored).toEqual({ [encodeExpansionPath(["first", "shared"])]: false });
  });

  it("ignores damaged expansion storage and uses defaults", async () => {
    localStorage.setItem(getExpansionStorageKey("log"), "not-json");

    await expect(
      renderComponent({
        variant: "log",
        settings: {
          actionHandler: jest.fn(),
          nodes: {
            root: { label: "Root", children: { child: { label: "Child" } } },
          },
        },
      }),
    ).resolves.toBeDefined();
    expect(screen.getByText("Child")).toBeInTheDocument();
  });

  it("continues to work when localStorage is unavailable", async () => {
    const getItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });

    const renderResult = await renderComponent({
      variant: "log",
      settings: {
        actionHandler: jest.fn(),
        nodes: {
          root: { label: "Root", children: { child: { label: "Child" } } },
        },
      },
    });
    await expect(
      renderResult.user.click(screen.getByTestId("settings__nodeHeaderToggle__root")),
    ).resolves.toBeUndefined();
    expect(screen.queryByText("Child")).not.toBeInTheDocument();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});

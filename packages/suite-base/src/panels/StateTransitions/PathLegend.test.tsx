/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import { userEvent } from "@storybook/testing-library";
import { render, screen } from "@testing-library/react";

import MockPanelContextProvider from "@lichtblick/suite-base/components/MockPanelContextProvider";
import { useSelectedPanels } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { PathLegendProps } from "@lichtblick/suite-base/panels/StateTransitions/types";
import { BasicBuilder } from "@lichtblick/test-builders";

import { PathLegend } from "./PathLegend";

jest.mock("@lichtblick/suite-base/context/CurrentLayoutContext");
jest.mock("@lichtblick/suite-base/context/Workspace/useWorkspaceActions");

describe("PathLegend Component", () => {
  const mockSetFocusedPath = jest.fn();
  const mockSaveConfig = jest.fn();
  const mockOpenPanelSettings = jest.fn();
  const mockSetSelectedPanelIds = jest.fn();

  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    (useSelectedPanels as jest.Mock).mockReturnValue({
      setSelectedPanelIds: mockSetSelectedPanelIds,
    });
    (useWorkspaceActions as jest.Mock).mockReturnValue({
      globalVariables: {},
      openPanelSettings: mockOpenPanelSettings,
      setGlobalVariables: jest.fn(),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const renderComponent = (propsOverride: Partial<PathLegendProps & { panelId: string }> = {}) => {
    const props: PathLegendProps = {
      heightPerRow: BasicBuilder.number({ min: 0, max: 5000 }),
      pathState: [
        {
          path: {
            value: BasicBuilder.string(),
            timestampMethod: BasicBuilder.sample(["receiveTime", "headerStamp"]),
          },
          isArray: false,
        },
        {
          path: {
            value: BasicBuilder.string(),
            timestampMethod: BasicBuilder.sample(["receiveTime", "headerStamp"]),
          },
          isArray: false,
        },
      ],
      saveConfig: mockSaveConfig,
      setFocusedPath: mockSetFocusedPath,
      ...propsOverride,
    };

    const ui: React.ReactElement = (
      <MockPanelContextProvider id={propsOverride.panelId}>
        <PathLegend {...props} />
      </MockPanelContextProvider>
    );

    return {
      ...render(ui),
      props,
      user: userEvent.setup(),
    };
  };

  it("should render correctly with provided paths", () => {
    const { props } = renderComponent();

    expect(screen.getByText(props.pathState[0]!.path.value)).toBeTruthy();
    expect(screen.getByText(props.pathState[1]!.path.value)).toBeTruthy();
  });

  it("should render default text when paths array is empty", () => {
    renderComponent({ pathState: [] });

    expect(screen.getByText("Click to add a series")).toBeTruthy();
  });

  it("should call setFocusedPath and openPanelSettings when edit button is clicked", async () => {
    const row = 0;
    const panelId = BasicBuilder.string();
    const { user } = renderComponent({ pathState: [], panelId });
    const editButton = screen.getByTestId(`edit-topic-button-${row}`);

    await user.click(editButton);

    expect(editButton).not.toBeNull();
    expect(mockSetSelectedPanelIds).toHaveBeenCalledWith([panelId]);
    expect(mockOpenPanelSettings).toHaveBeenCalled();
    expect(mockSetFocusedPath).toHaveBeenCalledWith(["paths", `${row}`]);
  });

  it("should call saveConfig with updated paths when delete button is clicked", async () => {
    const row = 0;
    const { user, props } = renderComponent();
    const deleteButton = screen.getByTestId(`delete-topic-button-${row}`);

    await user.click(deleteButton);

    expect(mockSaveConfig).toHaveBeenCalledWith({ paths: [props.pathState[1]!.path] });
  });

  it("should apply the correct height for each topic", () => {
    const { props } = renderComponent();
    const { style: firstRowStyle } = screen.getByTestId(`row-0-0`);
    const { style: secondRowStyle } = screen.getByTestId(`row-1-0`);
    const heightStyle = `height: ${props.heightPerRow}px;`;

    expect(firstRowStyle.cssText).toContain(heightStyle);
    expect(secondRowStyle.cssText).toContain(heightStyle);
  });

  it("renders one legend row per dynamic series", () => {
    const path = {
      value: "/states",
      label: "States",
      timestampMethod: "receiveTime" as const,
    };
    renderComponent({
      pathState: [
        {
          path,
          isArray: false,
          dynamicSeries: [
            { identity: "string:left", label: "left" },
            { identity: "string:right", label: "right" },
          ],
        },
      ],
    });

    expect(screen.getByText("States · left")).toBeTruthy();
    expect(screen.getByText("States · right")).toBeTruthy();
    expect(screen.getAllByTestId(/^row-0-/)).toHaveLength(2);
  });

  it("renders index-fallback series rows as [n]", () => {
    renderComponent({
      pathState: [
        {
          path: {
            value: "/states",
            label: "path",
            timestampMethod: "receiveTime" as const,
          },
          isArray: false,
          dynamicSeries: [{ identity: "index:0", label: "[0]", sourceIndex: 0 }],
        },
      ],
    });

    expect(screen.getByText("path · [0]")).toBeTruthy();
  });
});

/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";

import { AppSetting } from "@lichtblick/suite-base/AppSetting";
import { useAppConfigurationValue } from "@lichtblick/suite-base/hooks/useAppConfigurationValue";

import { AutoUpdate, McpServerSettings, StepSize } from "./settings";

jest.mock("@lichtblick/suite-base/hooks/useAppConfigurationValue", () => ({
  useAppConfigurationValue: jest.fn(),
}));

describe("StepSize component", () => {
  const mockSetStepSize = jest.fn();

  beforeEach(() => {
    (useAppConfigurationValue as jest.Mock).mockReturnValue([100, mockSetStepSize]);
    mockSetStepSize.mockClear();
  });

  it("renders the step size input field with default value", () => {
    render(<StepSize />);
    const input = screen.getByRole("spinbutton");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(100);
  });

  it("calls setStepSize when user types a new number", () => {
    render(<StepSize />);
    const input = screen.getByRole("spinbutton");

    fireEvent.change(input, { target: { value: "250" } });

    expect(mockSetStepSize).toHaveBeenCalledWith(250);
  });
});

describe("AutoUpdate component", () => {
  it("should render update.enable as false by default", () => {
    (useAppConfigurationValue as jest.Mock).mockReturnValue([undefined, jest.fn()]);

    render(<AutoUpdate />);
    const input: HTMLInputElement = screen.getByRole("checkbox");
    expect(input.checked).toBe(false);
  });

  it("should render a checked checkbox when update.enable is true", () => {
    (useAppConfigurationValue as jest.Mock).mockReturnValue([true, jest.fn()]);

    render(<AutoUpdate />);
    const input: HTMLInputElement = screen.getByRole("checkbox");
    expect(input.checked).toBe(true);
  });
});

describe("McpServerSettings component", () => {
  let updateMcpServer: jest.Mock;
  let configValues: Record<string, unknown>;
  let setters: Record<string, jest.Mock>;

  beforeEach(() => {
    updateMcpServer = jest.fn();
    configValues = {};
    setters = {};
    (global as { desktopBridge?: unknown }).desktopBridge = { updateMcpServer };
    (useAppConfigurationValue as jest.Mock).mockImplementation((key: string) => [
      configValues[key],
      (setters[key] ??= jest.fn()),
    ]);
  });

  afterEach(() => {
    delete (global as { desktopBridge?: unknown }).desktopBridge;
  });

  it("does not render anything when the desktopBridge global is missing", () => {
    delete (global as { desktopBridge?: unknown }).desktopBridge;

    render(<McpServerSettings />);

    expect(screen.queryByTestId("mcp-settings")).toBeNull();
    expect(updateMcpServer).not.toHaveBeenCalled();
  });

  it("writes MCP_ENABLED when the enable toggle changes", () => {
    configValues[AppSetting.MCP_ENABLED] = false;

    render(<McpServerSettings />);

    fireEvent.click(screen.getByRole("checkbox"));

    expect(setters[AppSetting.MCP_ENABLED]!).toHaveBeenCalledWith(true);
  });

  it("regenerates the token via updateMcpServer and displays the returned token", async () => {
    configValues[AppSetting.MCP_ENABLED] = true;
    configValues[AppSetting.MCP_TOKEN] = "old-token";
    updateMcpServer.mockResolvedValue({ enabled: true, port: 7333, token: "fresh-token" });

    render(<McpServerSettings />);
    expect(screen.getByDisplayValue("old-token")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate token" }));

    expect(updateMcpServer).toHaveBeenCalledWith({ regenerateToken: true });
    expect(await screen.findByDisplayValue("fresh-token")).toBeInTheDocument();
  });

  it("shows copy snippets containing the current port and token", () => {
    configValues[AppSetting.MCP_ENABLED] = true;
    configValues[AppSetting.MCP_TOKEN] = "sekret";
    configValues[AppSetting.MCP_PORT] = 9001;

    render(<McpServerSettings />);

    expect(
      screen.getByDisplayValue(
        'claude mcp add --transport http lichtblick http://127.0.0.1:9001/mcp --header "Authorization: Bearer sekret"',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(
        'npx mcp-remote http://127.0.0.1:9001/mcp --header "Authorization: Bearer sekret"',
      ),
    ).toBeInTheDocument();
  });
});

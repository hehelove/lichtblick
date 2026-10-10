/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";

import CallServicePanel from "./index";
import { Config } from "./types";

const baseConfig: Config = {
  serviceName: "/set_bool",
  requestPayload: `{ "data": true }`,
};

function setup(
  config: Config,
  callService: (service: string, request: unknown) => Promise<unknown>,
) {
  render(
    <PanelSetup
      fixture={{
        capabilities: [PLAYER_CAPABILITIES.callServices],
        callService,
      }}
    >
      <CallServicePanel overrideConfig={config} />
    </PanelSetup>,
  );
  return screen.getByTestId("call-service-button");
}

describe("CallService", () => {
  it("shows a timeout error and re-enables the button when the service never responds", async () => {
    const button = setup({ ...baseConfig, timeoutMs: 20 }, async () => await new Promise(() => {}));

    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Response")).toHaveValue(
        "Service call timed out after 20 ms",
      );
    });
    expect(button).toBeEnabled();

    // The timeout is expected and logged via log.error(); acknowledge and clear it.
    expect(console.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Service call timed out after 20 ms" }),
    );
    (console.error as jest.Mock).mockReset();
  });

  it("waits indefinitely for a slow service when no timeout is configured", async () => {
    const button = setup(
      baseConfig,
      async () =>
        await new Promise((resolve) => {
          setTimeout(() => {
            resolve({ success: true });
          }, 50);
        }),
    );

    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Response")).toHaveValue(`{
  "success": true
}`);
    });
  });
});

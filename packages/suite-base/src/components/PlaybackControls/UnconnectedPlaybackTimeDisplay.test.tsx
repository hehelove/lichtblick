/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, screen } from "@testing-library/react";

import { IAppTimeFormat } from "@lichtblick/suite-base/hooks/useAppTimeFormat";
import { TimeDisplayMethod } from "@lichtblick/suite-base/types/panels";

import { UnconnectedPlaybackTimeDisplay } from "./UnconnectedPlaybackTimeDisplay";

function makeAppTimeFormat(timeFormat: TimeDisplayMethod): IAppTimeFormat {
  return {
    formatDate: () => "",
    formatTime: () => "",
    formatDuration: () => "",
    timeFormat,
    setTimeFormat: async () => {},
    timeZone: "UTC",
  };
}

function makeProps(timeFormat: TimeDisplayMethod) {
  return {
    appTimeFormat: makeAppTimeFormat(timeFormat),
    currentTime: { sec: 65, nsec: 0 },
    startTime: { sec: 0, nsec: 0 },
    endTime: { sec: 100, nsec: 0 },
    onSeek: () => {},
    onPause: () => {},
    isPlaying: false,
    timezone: "UTC",
  };
}

describe("UnconnectedPlaybackTimeDisplay", () => {
  it("shows the format menu by default", () => {
    render(<UnconnectedPlaybackTimeDisplay {...makeProps("SEC")} />);
    expect(screen.getByTestId("playback-time-display-toggle-button")).toBeTruthy();
  });

  it("hides the format menu and shows raw seconds when showFormatMenu is false", () => {
    render(<UnconnectedPlaybackTimeDisplay {...makeProps("SEC")} showFormatMenu={false} />);
    expect(screen.queryByTestId("playback-time-display-toggle-button")).toBeNull();
    expect(screen.getByDisplayValue(/^65\./)).toBeTruthy();
  });
});

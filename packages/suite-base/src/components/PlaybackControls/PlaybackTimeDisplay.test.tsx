/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, cleanup, render, screen } from "@testing-library/react";

import MockMessagePipelineProvider from "@lichtblick/suite-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@lichtblick/suite-base/context/AppConfigurationContext";
import { useCompareStore } from "@lichtblick/suite-base/dataSources/compareStore";
import { makeMockAppConfiguration } from "@lichtblick/suite-base/util/makeMockAppConfiguration";

import PlaybackTimeDisplay from "./PlaybackTimeDisplay";

function comparisonTree(): React.JSX.Element {
  return (
    <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
      <MockMessagePipelineProvider
        name="Comparison: a.mcap, b.bag"
        currentTime={{ sec: 65, nsec: 0 }}
        startTime={{ sec: 0, nsec: 0 }}
        endTime={{ sec: 100, nsec: 0 }}
        isPlaying={false}
      >
        <PlaybackTimeDisplay onSeek={() => {}} onPause={() => {}} />
      </MockMessagePipelineProvider>
    </AppConfigurationContext.Provider>
  );
}

describe("PlaybackTimeDisplay (connector)", () => {
  afterEach(() => {
    cleanup(); // unmount first: endSession() on a mounted tree would act-warn
    useCompareStore.getState().endSession();
  });

  it("forces SEC display and hides the format menu while a comparison session is active", () => {
    act(() => {
      useCompareStore.setState({ active: true });
    });
    render(comparisonTree());

    expect(screen.queryByTestId("playback-time-display-toggle-button")).toBeNull();
    expect(screen.getByDisplayValue(/^65\./)).toBeTruthy();
  });

  it("restores the format menu after the comparison session ends", () => {
    act(() => {
      useCompareStore.setState({ active: true });
    });
    const { rerender } = render(comparisonTree());
    expect(screen.queryByTestId("playback-time-display-toggle-button")).toBeNull();

    act(() => {
      useCompareStore.getState().endSession();
    });
    rerender(comparisonTree());

    expect(screen.getByTestId("playback-time-display-toggle-button")).toBeTruthy();
  });
});

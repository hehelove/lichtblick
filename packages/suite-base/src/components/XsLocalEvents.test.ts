/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import "@testing-library/jest-dom";
import { act, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { StoreApi } from "zustand";

import { useGuaranteedContext } from "@lichtblick/hooks";
import { useAppContext } from "@lichtblick/suite-base/context/AppContext";
import {
  EventsContext,
  EventsStore,
  TimelinePositionedEvent,
} from "@lichtblick/suite-base/context/EventsContext";
import EventsProvider from "@lichtblick/suite-base/providers/EventsProvider";

import { localEventToPositioned, mergeLocalEvents, XsLocalEventsProvider } from "./XsLocalEvents";

// 2026-01-01T00:00:00Z — the epoch the fixtures below are relative to.
const startTime = { sec: 1767225600, nsec: 0 };
const endTime = { sec: 1767225610, nsec: 0 };

type MockActiveData = {
  startTime: { sec: number; nsec: number };
  endTime: { sec: number; nsec: number };
  currentTime: { sec: number; nsec: number };
  isPlaying: boolean;
};

const mockPipelineContext: { current: { playerState: { activeData?: MockActiveData } } } = {
  current: { playerState: { activeData: undefined } },
};

jest.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  useMessagePipeline: (
    selector: (ctx: { playerState: { activeData?: MockActiveData } }) => unknown,
  ) => selector(mockPipelineContext.current),
  useMessagePipelineGetter: () => () => mockPipelineContext.current,
}));

function makeFetchedEvent(startPosition: number): TimelinePositionedEvent {
  return {
    event: {
      id: `eval-${startPosition}`,
      createdAt: "",
      deviceId: "xs-eval",
      durationNanos: "0",
      endTime: { sec: 1767225605, nsec: 0 },
      endTimeInSeconds: 1767225605,
      startTime: { sec: 1767225605, nsec: 0 },
      startTimeInSeconds: 1767225605,
      timestampNanos: "1767225605000000000",
      updatedAt: "",
      metadata: {},
    },
    endPosition: startPosition,
    startPosition,
    secondsSinceStart: startPosition * 10,
  };
}

describe("localEventToPositioned", () => {
  it("derives clamped timeline fractions, end from duration, distinct ids", () => {
    const a = localEventToPositioned(
      {
        deviceId: "local",
        timestamp: "2026-01-01T00:00:05Z",
        durationNanos: "1000000000",
        metadata: { severity: "error" },
      },
      startTime,
      endTime,
    );
    expect(a.startPosition).toBeCloseTo(0.5);
    expect(a.endPosition).toBeCloseTo(0.6);
    expect(a.event.metadata.severity).toBe("error");
    expect(a.event.deviceId).toBe("local");
    expect(a.event.startTime).toEqual({ sec: 1767225605, nsec: 0 });
    expect(a.event.endTime).toEqual({ sec: 1767225606, nsec: 0 });

    const b = localEventToPositioned(
      { deviceId: "local", timestamp: "2026-01-01T00:00:50Z", durationNanos: "0", metadata: {} },
      startTime,
      endTime,
    );
    expect(b.startPosition).toBe(1); // clamp
    expect(a.event.id).not.toBe(b.event.id);
  });

  it("clamps events before the timeline start and survives a zero-length timeline", () => {
    const early = localEventToPositioned(
      { deviceId: "local", timestamp: "2025-12-31T23:59:55Z", durationNanos: "0", metadata: {} },
      startTime,
      endTime,
    );
    expect(early.startPosition).toBe(0);

    const zeroLength = localEventToPositioned(
      { deviceId: "local", timestamp: "2026-01-01T00:00:05Z", durationNanos: "0", metadata: {} },
      startTime,
      startTime,
    );
    expect(zeroLength.startPosition).toBe(0);
    expect(zeroLength.endPosition).toBe(0);
  });
});

describe("mergeLocalEvents", () => {
  it("keeps local entries across refetch, drops stale fetched entries, sorts by startPosition", () => {
    const local = localEventToPositioned(
      { deviceId: "local", timestamp: "2026-01-01T00:00:02Z", durationNanos: "0", metadata: {} },
      startTime,
      endTime,
    );
    const previous = [makeFetchedEvent(0.7), local];
    const fetched = [makeFetchedEvent(0.5)];

    const out = mergeLocalEvents(previous, fetched);

    expect(out).toHaveLength(2);
    expect(out[0]!.startPosition).toBeLessThanOrEqual(out[1]!.startPosition);
    expect(out.map((entry) => entry.event.deviceId)).toEqual(["local", "xs-eval"]);
  });
});

describe("XsLocalEventsProvider", () => {
  type Captured = {
    store?: StoreApi<EventsStore>;
    createEvent?: (args: {
      deviceId: string;
      timestamp: string;
      durationNanos: string;
      metadata: Record<string, string>;
    }) => Promise<void>;
  };

  function Probe(captured: Captured) {
    return function ProbeComponent() {
      captured.createEvent = useAppContext().createEvent;
      captured.store = useGuaranteedContext(EventsContext);
      return null;
    };
  }

  function tree(captured: Captured) {
    return createElement(
      EventsProvider,
      null,
      createElement(XsLocalEventsProvider, null, createElement(Probe(captured))),
    );
  }

  beforeEach(() => {
    mockPipelineContext.current = {
      playerState: {
        activeData: {
          startTime,
          endTime,
          currentTime: { sec: 1767225605, nsec: 0 },
          isPlaying: false,
        },
      },
    };
  });

  it("marks events supported with the local device and appends created events sorted", async () => {
    const captured: Captured = {};
    render(tree(captured));

    await waitFor(() => {
      expect(captured.store?.getState().eventsSupported).toBe(true);
    });
    expect(captured.store?.getState().deviceId).toBe("local");
    expect(captured.createEvent).toBeDefined();

    await act(async () => {
      await captured.createEvent?.({
        deviceId: "local",
        timestamp: "2026-01-01T00:00:05Z",
        durationNanos: "1000000000",
        metadata: { severity: "warning" },
      });
    });

    const events = captured.store?.getState().events.value ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]?.event.deviceId).toBe("local");
    expect(events[0]?.startPosition).toBeCloseTo(0.5);
    expect(events[0]?.endPosition).toBeCloseTo(0.6);

    await act(async () => {
      await captured.createEvent?.({
        deviceId: "local",
        timestamp: "2026-01-01T00:00:03Z",
        durationNanos: "0",
        metadata: {},
      });
    });

    const eventsAfterSecondCreate = captured.store?.getState().events.value ?? [];
    expect(eventsAfterSecondCreate).toHaveLength(2);
    expect(eventsAfterSecondCreate.map((entry) => entry.startPosition)).toEqual([0.3, 0.5]);
  });

  it("no-ops createEvent when the player has no active data", async () => {
    mockPipelineContext.current = { playerState: { activeData: undefined } };
    const captured: Captured = {};
    render(tree(captured));

    await act(async () => {
      await captured.createEvent?.({
        deviceId: "local",
        timestamp: "2026-01-01T00:00:05Z",
        durationNanos: "0",
        metadata: {},
      });
    });

    expect(captured.store?.getState().events.value ?? []).toHaveLength(0);
  });

  it("resets support and device when the timeline disappears", async () => {
    const captured: Captured = {};
    const { rerender } = render(tree(captured));

    await waitFor(() => {
      expect(captured.store?.getState().eventsSupported).toBe(true);
    });

    mockPipelineContext.current = { playerState: { activeData: undefined } };
    rerender(tree(captured));

    await waitFor(() => {
      expect(captured.store?.getState().eventsSupported).toBe(false);
    });
    expect(captured.store?.getState().deviceId).toBeUndefined();
  });

  it("does not clobber externally-provided events support without a timeline", () => {
    mockPipelineContext.current = { playerState: { activeData: undefined } };
    const captured: Captured = {};
    const { rerender } = render(tree(captured));
    const store = captured.store!;

    // Simulate XsEvalEventsBridge enabling events via ?xsEvents= without a loaded player.
    act(() => {
      store.getState().setEventsSupported(true);
    });

    rerender(tree(captured));

    expect(store.getState().eventsSupported).toBe(true);
  });
});

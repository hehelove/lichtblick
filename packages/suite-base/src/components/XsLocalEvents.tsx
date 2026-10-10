// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// xs fork: 本地事件 producer。为本地(非云端)数据源提供 AppContext.createEvent，
// 与 XsEvalEventsBridge 注入的评测事件共存于同一个 EventsContext。

import { useEffect, useMemo, useRef } from "react";

import { useGuaranteedContext } from "@lichtblick/hooks";
import {
  add as addTimes,
  fromDate,
  fromSec,
  subtract as subtractTimes,
  toNanoSec,
  toSec,
  Time,
} from "@lichtblick/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { AppContext, IAppContext } from "@lichtblick/suite-base/context/AppContext";
import {
  EventsContext,
  EventsStore,
  TimelinePositionedEvent,
  useEvents,
} from "@lichtblick/suite-base/context/EventsContext";

export type LocalEventArgs = {
  deviceId: string;
  timestamp: string;
  durationNanos: string;
  metadata: Record<string, string>;
};

// jsdom has no stable crypto.randomUUID — a module counter keeps ids unique per session.
let nextLocalEventId = 0;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function localEventToPositioned(
  args: LocalEventArgs,
  playerStart: Time,
  playerEnd: Time,
): TimelinePositionedEvent {
  const date = new Date(args.timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid event timestamp: ${args.timestamp}`);
  }
  const startTime = fromDate(date);
  const durationSec = toSec(subtractTimes(playerEnd, playerStart));
  const offsetSec = toSec(subtractTimes(startTime, playerStart));
  const frac = durationSec > 0 ? clamp01(offsetSec / durationSec) : 0;
  const durationNanos = Number(args.durationNanos);
  const endFrac = durationSec > 0 ? clamp01(frac + durationNanos / 1e9 / durationSec) : frac;
  const duration = fromSec(durationNanos / 1e9);
  const endTime = addTimes(startTime, duration);

  return {
    event: {
      id: `local-${++nextLocalEventId}`,
      createdAt: new Date().toISOString(),
      deviceId: args.deviceId,
      durationNanos: args.durationNanos,
      endTime,
      endTimeInSeconds: toSec(endTime),
      startTime,
      startTimeInSeconds: toSec(startTime),
      timestampNanos: toNanoSec(startTime).toString(),
      updatedAt: new Date().toISOString(),
      metadata: args.metadata,
    },
    endPosition: endFrac,
    startPosition: frac,
    secondsSinceStart: frac * durationSec,
  };
}

/**
 * Keeps locally created events (`event.deviceId === "local"`) when fetched events replace
 * the list, and returns the union re-sorted by startPosition.
 */
export function mergeLocalEvents(
  previous: TimelinePositionedEvent[] | undefined,
  fetched: TimelinePositionedEvent[],
): TimelinePositionedEvent[] {
  const keptLocal = (previous ?? []).filter((entry) => entry.event.deviceId === "local");
  return [...keptLocal, ...fetched].sort((a, b) => a.startPosition - b.startPosition);
}

const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectSetEventsSupported = (store: EventsStore) => store.setEventsSupported;
const selectSetDeviceId = (store: EventsStore) => store.setDeviceId;

/**
 * Provides AppContext.createEvent for local sources. Mount under EventsProvider; wraps the
 * subtree that needs it (Workspace wraps the PlaybackControls block).
 */
export function XsLocalEventsProvider({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const eventsStore = useGuaranteedContext(EventsContext);
  const getMessagePipeline = useMessagePipelineGetter();
  const startTime = useMessagePipeline(selectStartTime);
  const setEventsSupported = useEvents(selectSetEventsSupported);
  const setDeviceId = useEvents(selectSetDeviceId);

  // Only reset what we set ourselves, so XsEvalEventsBridge's ?xsEvents= support is untouched.
  const setByLocalRef = useRef(false);

  useEffect(() => {
    if (startTime != undefined) {
      setByLocalRef.current = true;
      setEventsSupported(true);
      setDeviceId("local");
    } else if (setByLocalRef.current) {
      setByLocalRef.current = false;
      setEventsSupported(false);
      setDeviceId(undefined);
    }
  }, [startTime, setEventsSupported, setDeviceId]);

  const appContextValue = useMemo<IAppContext>(
    () => ({
      wrapPlayer: (child) => child,
      createEvent: async (args) => {
        const { startTime: playerStart, endTime: playerEnd } =
          getMessagePipeline().playerState.activeData ?? {};
        if (playerStart == undefined || playerEnd == undefined) {
          return;
        }
        const positioned = localEventToPositioned(args, playerStart, playerEnd);
        // Read via StoreApi.getState() so concurrent events are not lost to a stale closure.
        const { events, setEvents } = eventsStore.getState();
        const current = [...(events.value ?? [])];
        const nonLocal = current.filter((entry) => entry.event.deviceId !== "local");
        setEvents({ loading: false, value: mergeLocalEvents(current, [...nonLocal, positioned]) });
      },
    }),
    [eventsStore, getMessagePipeline],
  );

  return <AppContext.Provider value={appContextValue}>{children}</AppContext.Provider>;
}

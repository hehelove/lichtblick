// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// xs fork: 从 URL ?xsEvents= 拉取平台评测事件，注入 EventsContext 供 EventsOverlay / EventsList 使用。

import { useEffect, useMemo } from "react";

import {
  add as addTimes,
  fromSec,
  subtract as subtractTimes,
  toNanoSec,
  toSec,
  Time,
} from "@lichtblick/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  EventsStore,
  TimelinePositionedEvent,
  useEvents,
} from "@lichtblick/suite-base/context/EventsContext";

type CaseEvent = {
  id?: unknown;
  frac?: unknown;
  type?: unknown;
  severity?: unknown;
  message?: unknown;
  category?: unknown;
  trackId?: unknown;
  source?: unknown;
  threshold?: unknown;
  actual?: unknown;
};

function getXsEventsUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get("xsEvents") ?? "";
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function metaString(v: Record<string, unknown>): string {
  return JSON.stringify(v) ?? "";
}

function caseEventToPositioned(
  ev: CaseEvent,
  playerStart: Time,
  playerEnd: Time,
): TimelinePositionedEvent {
  const durationSec = toSec(subtractTimes(playerEnd, playerStart));
  const frac =
    typeof ev.frac === "number" && Number.isFinite(ev.frac) ? Math.max(0, Math.min(1, ev.frac)) : 0;
  const startTime = addTimes(playerStart, fromSec(frac * durationSec));
  const startSec = toSec(startTime);

  const metadata: Record<string, string> = {
    type: typeof ev.type === "string" ? ev.type : "",
    severity: typeof ev.severity === "string" ? ev.severity : "info",
    message: typeof ev.message === "string" ? ev.message : "",
  };
  if (typeof ev.category === "string" && ev.category) {
    metadata.category = ev.category;
  }
  if (typeof ev.trackId === "number" && Number.isFinite(ev.trackId)) {
    metadata.track_id = String(ev.trackId);
  }
  if (typeof ev.source === "string" && ev.source) {
    metadata.source = ev.source;
  }
  if (isRecord(ev.threshold) && Object.keys(ev.threshold).length > 0) {
    metadata.threshold = metaString(ev.threshold);
  }
  if (isRecord(ev.actual) && Object.keys(ev.actual).length > 0) {
    metadata.actual = metaString(ev.actual);
  }

  return {
    event: {
      id: `eval-${typeof ev.id === "number" && Number.isFinite(ev.id) ? ev.id : 0}`,
      createdAt: "",
      deviceId: "xs-eval",
      durationNanos: "0",
      endTime: startTime,
      endTimeInSeconds: startSec,
      startTime,
      startTimeInSeconds: startSec,
      timestampNanos: toNanoSec(startTime).toString(),
      updatedAt: "",
      metadata,
    },
    startPosition: frac,
    endPosition: frac,
    secondsSinceStart: frac * durationSec,
  };
}

export function caseEventsToPositioned(
  data: unknown,
  playerStart: Time,
  playerEnd: Time,
): TimelinePositionedEvent[] {
  if (!isRecord(data) || !Array.isArray(data.list)) {
    return [];
  }

  return data.list
    .filter(isRecord)
    .map((event) => caseEventToPositioned(event, playerStart, playerEnd))
    .sort((a, b) => a.startPosition - b.startPosition);
}

const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectSetEvents = (store: EventsStore) => store.setEvents;
const selectSetEventsSupported = (store: EventsStore) => store.setEventsSupported;

function timeKey(t: Time | undefined): string {
  if (!t) {
    return "";
  }
  return `${t.sec}.${t.nsec}`;
}

/** 无 UI；有 xsEvents URL 时拉取评测事件并写入 EventsContext。 */
export function XsEvalEventsBridge(): ReactNull {
  const eventsUrl = useMemo(() => getXsEventsUrl(), []);
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  const startKey = timeKey(startTime);
  const endKey = timeKey(endTime);
  const setEvents = useEvents(selectSetEvents);
  const setEventsSupported = useEvents(selectSetEventsSupported);

  useEffect(() => {
    if (!eventsUrl) {
      return;
    }
    setEventsSupported(true);
  }, [eventsUrl, setEventsSupported]);

  useEffect(() => {
    if (!eventsUrl || !startKey || !endKey || !startTime || !endTime) {
      return;
    }

    let cancelled = false;

    const load = () => {
      setEvents({ loading: true });
      void fetch(eventsUrl)
        .then(async (r): Promise<unknown> => (r.ok ? await r.json() : { list: [] }))
        .then((data: unknown) => {
          if (cancelled) {
            return;
          }
          const positioned = caseEventsToPositioned(data, startTime, endTime);
          setEvents({ loading: false, value: positioned });
        })
        .catch((err: unknown) => {
          if (cancelled) {
            return;
          }
          setEvents({
            loading: false,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        });
    };

    load();
    const onRefresh = () => {
      load();
    };
    window.addEventListener("xs-eval-events-refresh", onRefresh);

    return () => {
      cancelled = true;
      window.removeEventListener("xs-eval-events-refresh", onRefresh);
    };
  }, [eventsUrl, startKey, endKey, startTime, endTime, setEvents]);

  return ReactNull;
}

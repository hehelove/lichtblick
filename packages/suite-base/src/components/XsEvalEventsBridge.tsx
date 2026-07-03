// xs fork: 从 URL ?xsEvents= 拉取平台评测事件，注入 EventsContext 供 EventsOverlay / EventsList 使用。

import { useEffect, useMemo } from "react";

import { add as addTimes, fromSec, subtract as subtractTimes, toNanoSec, toSec, Time } from "@lichtblick/rostime";
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
  id: number;
  frac: number;
  tns: number;
  type: string;
  severity: string;
  message: string;
  category?: string;
  trackId?: number;
  source?: string;
  threshold?: Record<string, unknown>;
  actual?: Record<string, unknown>;
};

function getXsEventsUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get("xsEvents") ?? "";
  } catch {
    return "";
  }
}

function metaString(v: unknown): string {
  if (v == null) {
    return "";
  }
  if (typeof v === "object") {
    return JSON.stringify(v) ?? "";
  }
  return String(v);
}

function caseEventToPositioned(
  ev: CaseEvent,
  playerStart: Time,
  playerEnd: Time,
): TimelinePositionedEvent {
  const durationSec = toSec(subtractTimes(playerEnd, playerStart));
  const frac = Math.max(0, Math.min(1, ev.frac ?? 0));
  const startTime = addTimes(playerStart, fromSec(frac * durationSec));
  const startSec = toSec(startTime);

  const metadata: Record<string, string> = {
    type: ev.type ?? "",
    severity: ev.severity ?? "info",
    message: ev.message ?? "",
  };
  if (ev.category) {
    metadata.category = ev.category;
  }
  if (ev.trackId != null) {
    metadata.track_id = String(ev.trackId);
  }
  if (ev.source) {
    metadata.source = ev.source;
  }
  if (ev.threshold && Object.keys(ev.threshold).length > 0) {
    metadata.threshold = metaString(ev.threshold);
  }
  if (ev.actual && Object.keys(ev.actual).length > 0) {
    metadata.actual = metaString(ev.actual);
  }

  return {
    event: {
      id: `eval-${ev.id}`,
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
        .then((r) => (r.ok ? r.json() : { list: [] }))
        .then((d: { list?: CaseEvent[] }) => {
          if (cancelled) {
            return;
          }
          const list = d.list ?? [];
          const positioned = list.map((ev) => caseEventToPositioned(ev, startTime, endTime));
          positioned.sort((a, b) => a.startPosition - b.startPosition);
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

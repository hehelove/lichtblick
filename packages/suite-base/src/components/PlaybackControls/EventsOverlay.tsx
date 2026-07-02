// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { alpha, useTheme } from "@mui/material";
import * as _ from "lodash-es";
import { useCallback, useMemo } from "react";
import { makeStyles } from "tss-react/mui";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  EventsStore,
  TimelinePositionedEvent,
  useEvents,
} from "@lichtblick/suite-base/context/EventsContext";
import {
  TimelineInteractionStateStore,
  useTimelineInteractionState,
} from "@lichtblick/suite-base/context/TimelineInteractionStateContext";

/** 时间轴上相邻事件合并为簇的 frac 阈值（约 0.25% 时长）。 */
const CLUSTER_FRAC_EPS = 0.0025;
/** 点事件最小显示宽度（占时间轴比例）。 */
const MIN_POINT_FRAC = 0.004;

type EventCluster = {
  events: TimelinePositionedEvent[];
  minPosition: number;
  maxPosition: number;
};

function clusterEvents(events: TimelinePositionedEvent[]): EventCluster[] {
  const sorted = [...events].sort((a, b) => a.startPosition - b.startPosition);
  const clusters: EventCluster[] = [];

  for (const ev of sorted) {
    const last = clusters[clusters.length - 1];
    if (last != undefined && ev.startPosition - last.maxPosition < CLUSTER_FRAC_EPS) {
      last.events.push(ev);
      last.maxPosition = Math.max(last.maxPosition, ev.startPosition);
    } else {
      clusters.push({
        events: [ev],
        minPosition: ev.startPosition,
        maxPosition: ev.startPosition,
      });
    }
  }
  return clusters;
}

function clusterSeverity(events: TimelinePositionedEvent[]): string {
  const order = { error: 3, warning: 2, info: 1 };
  let best = "info";
  let bestRank = 0;
  for (const ev of events) {
    const sev = (ev.event.metadata.severity ?? "info").toLowerCase();
    const rank = order[sev as keyof typeof order] ?? 1;
    if (rank > bestRank) {
      bestRank = rank;
      best = sev;
    }
  }
  return best;
}

function clusterTitle(cluster: EventCluster): string {
  if (cluster.events.length === 1) {
    const ev = cluster.events[0]!.event;
    const sev = ev.metadata.severity ?? "info";
    const typ = ev.metadata.type ?? "";
    const msg = ev.metadata.message ?? "";
    return `[${sev}] ${typ}${msg ? `: ${msg}` : ""}`;
  }
  const lines = cluster.events.map((e) => {
    const m = e.event.metadata;
    return `[${m.severity ?? "info"}] ${m.type ?? ""}${m.message ? `: ${m.message}` : ""}`;
  });
  return `${cluster.events.length} events\n${lines.join("\n")}`;
}

const useStyles = makeStyles()(({ transitions, palette }) => ({
  root: {
    inset: 0,
    pointerEvents: "none",
    position: "absolute",
    display: "flex",
    alignItems: "center",
    zIndex: 4,
  },
  tick: {
    transition: transitions.create("height", { duration: transitions.duration.shortest }),
    backgroundBlendMode: "overlay",
    position: "absolute",
    height: 8,
    minWidth: 4,
    borderRadius: 1,
    cursor: "pointer",
    pointerEvents: "auto",
    boxSizing: "border-box",
  },
  tickHovered: {
    height: 14,
    border: `1px solid currentColor`,
  },
  tickSelected: {
    height: 14,
    boxShadow: `0 0 0 1px currentColor`,
  },
  tickCluster: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    fontSize: 9,
    fontWeight: 700,
    color: palette.common.white,
    lineHeight: 1,
    paddingBottom: 1,
  },
  severityError: {
    backgroundColor: alpha(palette.error.main, 0.72),
    color: palette.error.main,
  },
  severityWarning: {
    backgroundColor: alpha(palette.warning.main, 0.78),
    color: palette.warning.main,
  },
  severityInfo: {
    backgroundColor: alpha(palette.info.main, 0.58),
    color: palette.info.main,
  },
}));

const selectEvents = (store: EventsStore) => store.events;
const selectHoveredEvent = (store: TimelineInteractionStateStore) => store.hoveredEvent;
const selectSetHoveredEvent = (store: TimelineInteractionStateStore) => store.setHoveredEvent;
const selectSelectedEventId = (store: EventsStore) => store.selectedEventId;
const selectSelectEvent = (store: EventsStore) => store.selectEvent;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;

function EventClusterTick({ cluster }: { cluster: EventCluster }): React.JSX.Element {
  const hoveredEvent = useTimelineInteractionState(selectHoveredEvent);
  const setHoveredEvent = useTimelineInteractionState(selectSetHoveredEvent);
  const selectedEventId = useEvents(selectSelectedEventId);
  const selectEvent = useEvents(selectSelectEvent);
  const seek = useMessagePipeline(selectSeek);
  const { classes, cx } = useStyles();
  const theme = useTheme();

  const primary = cluster.events[0]!;
  const severity = clusterSeverity(cluster.events);
  const severityClass =
    severity === "error"
      ? classes.severityError
      : severity === "warning"
        ? classes.severityWarning
        : classes.severityInfo;

  const span = Math.max(cluster.maxPosition - cluster.minPosition, MIN_POINT_FRAC);
  const center = cluster.minPosition + span / 2;
  const leftPct = _.clamp(center, 0, 1) * 100;
  const widthPct = _.clamp(span, MIN_POINT_FRAC, 1) * 100;

  const isHovered = cluster.events.some((e) => e.event.id === hoveredEvent?.event.id);
  const isSelected = cluster.events.some((e) => e.event.id === selectedEventId);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const target = primary;
      if (target.event.id === selectedEventId) {
        selectEvent(undefined);
      } else {
        selectEvent(target.event.id);
      }
      seek?.(target.event.startTime);
    },
    [primary, seek, selectEvent, selectedEventId],
  );

  const onMouseEnter = useCallback(() => {
    setHoveredEvent(primary);
  }, [primary, setHoveredEvent]);

  const onMouseLeave = useCallback(() => {
    setHoveredEvent(undefined);
  }, [setHoveredEvent]);

  return (
    <div
      className={cx(
        classes.tick,
        severityClass,
        cluster.events.length > 1 && classes.tickCluster,
        {
          [classes.tickHovered]: isHovered,
          [classes.tickSelected]: isSelected,
        },
      )}
      style={{
        left: `calc(${leftPct}% - ${theme.spacing(0.25)})`,
        width: `max(${theme.spacing(0.5)}, ${widthPct}%)`,
        transform: "translateX(-50%)",
      }}
      title={clusterTitle(cluster)}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {cluster.events.length > 1 ? cluster.events.length : undefined}
    </div>
  );
}

const MemoEventClusterTick = React.memo(EventClusterTick);

export function EventsOverlay(): React.JSX.Element {
  const events = useEvents(selectEvents);
  const { classes } = useStyles();

  const clusters = useMemo(
    () => clusterEvents(events.value ?? []),
    [events.value],
  );

  if (clusters.length === 0) {
    return <ReactNull />;
  }

  return (
    <div className={classes.root}>
      {clusters.map((cluster) => (
        <MemoEventClusterTick
          key={cluster.events.map((e) => e.event.id).join(",")}
          cluster={cluster}
        />
      ))}
    </div>
  );
}

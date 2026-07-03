// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { alpha, useTheme } from "@mui/material";
import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import {
  XsEvalEventTooltip,
  type XsEvalTooltipState,
} from "./XsEvalEventTooltip";

/** 时间轴上相邻事件合并为簇的 frac 阈值（约 0.25% 时长）。 */
const CLUSTER_FRAC_EPS = 0.0025;
/** 点事件最小显示宽度（占时间轴比例）。 */
const MIN_POINT_FRAC = 0.004;

type EventCluster = {
  events: TimelinePositionedEvent[];
  minPosition: number;
  maxPosition: number;
};

function clusterEvents(events: readonly TimelinePositionedEvent[]): EventCluster[] {
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

type TickTooltipHandlers = {
  onHoverStart: (cluster: EventCluster, anchor: HTMLElement) => void;
  onHoverEnd: () => void;
  onPin: (cluster: EventCluster, anchor: HTMLElement) => void;
  onUnpin: () => void;
};

function EventClusterTick({
  cluster,
  tooltipHandlers,
}: {
  cluster: EventCluster;
  tooltipHandlers: TickTooltipHandlers;
}): React.JSX.Element {
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
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const target = primary;
      const el = e.currentTarget;
      if (target.event.id === selectedEventId) {
        selectEvent(undefined);
        tooltipHandlers.onUnpin();
      } else {
        selectEvent(target.event.id);
        tooltipHandlers.onPin(cluster, el);
      }
      seek?.(target.event.startTime);
    },
    [cluster, primary, seek, selectEvent, selectedEventId, tooltipHandlers],
  );

  const onMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      setHoveredEvent(primary);
      tooltipHandlers.onHoverStart(cluster, e.currentTarget);
    },
    [cluster, primary, setHoveredEvent, tooltipHandlers],
  );

  const onMouseLeave = useCallback(() => {
    setHoveredEvent(undefined);
    tooltipHandlers.onHoverEnd();
  }, [setHoveredEvent, tooltipHandlers]);

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
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-testid="xs-eval-event-tick"
    >
      {cluster.events.length > 1 ? cluster.events.length : undefined}
    </div>
  );
}

const MemoEventClusterTick = React.memo(EventClusterTick);

export function EventsOverlay(): React.JSX.Element | null {
  const events = useEvents(selectEvents);
  const selectedEventId = useEvents(selectSelectedEventId);
  const selectEvent = useEvents(selectSelectEvent);
  const { classes } = useStyles();

  const [hoverTip, setHoverTip] = useState<XsEvalTooltipState | undefined>();
  const pinnedTipRef = useRef<XsEvalTooltipState | undefined>(undefined);
  const [, forcePinRender] = useState(0);

  const clusters = useMemo(
    () => clusterEvents(events.value ?? []),
    [events.value],
  );

  const setPinnedTip = useCallback((state: XsEvalTooltipState | undefined) => {
    pinnedTipRef.current = state;
    forcePinRender((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!selectedEventId) {
      pinnedTipRef.current = undefined;
      forcePinRender((n) => n + 1);
    }
  }, [selectedEventId]);

  const tooltipHandlers = useMemo<TickTooltipHandlers>(
    () => ({
      onHoverStart: (cluster, anchor) => {
        setHoverTip({ anchor, events: cluster.events });
      },
      onHoverEnd: () => {
        setHoverTip(undefined);
      },
      onPin: (cluster, anchor) => {
        setPinnedTip({ anchor, events: cluster.events });
      },
      onUnpin: () => {
        setPinnedTip(undefined);
      },
    }),
    [setPinnedTip],
  );

  // 点击标记外区域取消固定（对齐旧版 bootstrap）。
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || t.closest('[data-testid="xs-eval-event-tick"]') == undefined) {
        if (pinnedTipRef.current) {
          pinnedTipRef.current = undefined;
          forcePinRender((n) => n + 1);
        }
        if (selectedEventId) {
          selectEvent(undefined);
        }
      }
    };
    document.addEventListener("mousedown", onDocDown, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown, true);
    };
  }, [selectEvent, selectedEventId]);

  const activeTip = hoverTip ?? pinnedTipRef.current;

  if (clusters.length === 0) {
    return ReactNull;
  }

  return (
    <>
      <div className={classes.root}>
        {clusters.map((cluster) => (
          <MemoEventClusterTick
            key={cluster.events.map((e) => e.event.id).join(",")}
            cluster={cluster}
            tooltipHandlers={tooltipHandlers}
          />
        ))}
      </div>
      <XsEvalEventTooltip state={activeTip} />
    </>
  );
}

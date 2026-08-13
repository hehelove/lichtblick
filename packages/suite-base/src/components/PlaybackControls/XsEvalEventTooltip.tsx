// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// xs fork: 评测事件标记悬浮详情（对齐旧版 xs-ext-bootstrap 的 xs-ev-tip）。

import { Fragment, type ReactPortal, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { makeStyles } from "tss-react/mui";

import type { TimelinePositionedEvent } from "@lichtblick/suite-base/context/EventsContext";

const SEV_COLORS: Record<string, string> = {
  error: "#f5222d",
  warning: "#faad14",
  info: "#1890ff",
};

const CAT_LABEL: Record<string, string> = {
  safety: "安全",
  compliance: "合规",
  efficiency: "效率",
  comfort: "体感",
  navigation: "导航",
  other: "其他",
};

function parseMetaJSON(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const v: unknown = JSON.parse(raw);
    return v != null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function eventDetailLines(ev: TimelinePositionedEvent): string[] {
  const m = ev.event.metadata;
  const lines: string[] = [];
  const meta: string[] = [];
  const cat = m.category;
  if (cat && CAT_LABEL[cat]) {
    meta.push(CAT_LABEL[cat]);
  }
  const trackId = m.track_id;
  if (trackId) {
    meta.push(`track_id=${trackId}`);
  }
  if (meta.length > 0) {
    lines.push(meta.join(" | "));
  }
  const thr = parseMetaJSON(m.threshold);
  const act = parseMetaJSON(m.actual);
  const keys = new Set([...Object.keys(thr), ...Object.keys(act)]);
  for (const k of keys) {
    const a = act[k];
    const t = thr[k];
    // 值来自解析后的 JSON；保留既有的 String 展示格式。
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    lines.push(`${k}: ${a != null ? String(a) : "-"} / 阈值 ${t != null ? String(t) : "-"}`);
  }
  return lines;
}

function sourceLabel(source: string | undefined): string {
  if (source === "metric") {
    return "评测";
  }
  if (source === "manual") {
    return "人工";
  }
  return "";
}

const useStyles = makeStyles()(() => ({
  tip: {
    position: "fixed",
    zIndex: 99999,
    maxWidth: 300,
    background: "rgba(20, 20, 24, 0.97)",
    color: "#fff",
    fontSize: 12,
    lineHeight: 1.5,
    padding: "6px 9px",
    borderRadius: 6,
    boxShadow: "0 4px 14px rgba(0, 0, 0, 0.45)",
    pointerEvents: "none",
    whiteSpace: "normal",
  },
  header: {
    fontWeight: 600,
    marginBottom: 2,
  },
  src: {
    marginLeft: 6,
    padding: "0 5px",
    borderRadius: 8,
    fontSize: 10,
    fontWeight: 500,
    verticalAlign: "middle",
    background: "rgba(255, 255, 255, 0.18)",
    color: "#fff",
  },
  message: {
    color: "#e6e6e6",
  },
  kv: {
    color: "#bdbdbd",
    fontFamily: "monospace",
    fontSize: 11,
  },
  divider: {
    borderTop: "1px solid rgba(255,255,255,0.15)",
    margin: "6px 0",
  },
}));

function EventBlock({ ev }: { ev: TimelinePositionedEvent }): React.JSX.Element {
  const { classes } = useStyles();
  const m = ev.event.metadata;
  const sev = (m.severity ?? "info").toLowerCase();
  const color = SEV_COLORS[sev] ?? SEV_COLORS.info!;
  const src = sourceLabel(m.source);
  const detail = eventDetailLines(ev);

  return (
    <div>
      <div className={classes.header} style={{ color }}>
        [{sev}] {m.type ?? ""}
        {src ? <span className={classes.src}>{src}</span> : undefined}
      </div>
      {m.message ? <div className={classes.message}>{m.message}</div> : undefined}
      {detail.map((line) => (
        <div key={line} className={classes.kv}>
          {line}
        </div>
      ))}
    </div>
  );
}

export type XsEvalTooltipState = {
  anchor: HTMLElement;
  events: TimelinePositionedEvent[];
};

export function XsEvalEventTooltip({
  state,
}: {
  state: XsEvalTooltipState | undefined;
}): ReactPortal | ReactNull {
  const { classes } = useStyles();
  const tipRef = useRef<HTMLDivElement>(ReactNull);
  const [pos, setPos] = useState<{ left: number; top: number } | undefined>();

  useLayoutEffect(() => {
    if (!state) {
      setPos(undefined);
      return;
    }
    const tip = tipRef.current;
    if (!tip) {
      return;
    }
    const r = state.anchor.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let left = r.left + r.width / 2 - tr.width / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - tr.width - 6));
    let top = r.top - tr.height - 8;
    if (top < 6) {
      top = r.bottom + 8;
    }
    setPos({ left, top });
  }, [state]);

  if (!state) {
    return ReactNull;
  }

  return createPortal(
    <div
      ref={tipRef}
      className={classes.tip}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {state.events.map((ev, i) => (
        <Fragment key={ev.event.id}>
          {i > 0 ? <div className={classes.divider} /> : undefined}
          <EventBlock ev={ev} />
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}

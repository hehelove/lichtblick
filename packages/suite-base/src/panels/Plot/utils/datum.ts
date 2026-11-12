// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ScatterDataPoint } from "chart.js";

import { isTime, toSec } from "@lichtblick/rostime";
import { Time } from "@lichtblick/suite";

import { MathFunction } from "./mathFunctions";

// In addition to the base datum, we also add receiveTime and optionally header stamp to our datums
// These are used in the csv export.
export type Datum = ScatterDataPoint & {
  value: OriginalValue;
  receiveTime: Time;
  headerStamp?: Time;
};

export type OriginalValue = string | bigint | number | boolean | Time | null;

export function isChartValue(value: unknown): value is OriginalValue {
  // eslint-disable-next-line @lichtblick/strict-equality
  if (value === null) {
    return true;
  }
  switch (typeof value) {
    case "bigint":
    case "boolean":
    case "number":
    case "string":
      return true;
    case "object":
      if (isTime(value)) {
        return true;
      }
      return false;
    default:
      return false;
  }
}

export function getChartValue(value: unknown): number | undefined {
  // eslint-disable-next-line @lichtblick/strict-equality
  if (value === null) {
    return Number.NaN;
  }
  switch (typeof value) {
    case "bigint":
      return Number(value);
    case "boolean":
      return Number(value);
    case "number":
      return value;
    case "object":
      if (isTime(value)) {
        return toSec(value);
      }
      return undefined;
    case "string":
      return +value;
    default:
      return undefined;
  }
}

export type ChartDatum = { y: number; value: OriginalValue };

/**
 * Resolves a raw message-path item into a chart-safe {y, value} pair, applying an optional math
 * modifier. Returns undefined when the item cannot be plotted at all.
 *
 * A `null` item represents a gap: `y` is NaN (breaks the line/segment) but `value` stays `null`
 * (not NaN) so CSV export and tooltips render blank instead of the literal text "NaN".
 */
export function resolveChartDatum(
  item: unknown,
  mathFunction?: MathFunction,
): ChartDatum | undefined {
  // eslint-disable-next-line @lichtblick/strict-equality
  if (item === null) {
    // A null item is a gap: the math function never sees it.
    return { y: Number.NaN, value: null };
  }
  // xs: local math functions (@yaw/@ypr/@norm, …) consume the raw item — e.g. a
  // quaternion object — rather than the pre-converted number, so they run before
  // the scalar gate and their numeric output is the datum itself.
  if (mathFunction) {
    const y = mathFunction(item);
    return { y, value: y };
  }
  if (!isChartValue(item)) {
    return undefined;
  }
  const chartValue = getChartValue(item);
  if (chartValue == undefined) {
    return undefined;
  }

  if (Number.isNaN(chartValue)) {
    return { y: chartValue, value: null };
  }
  return { y: chartValue, value: item };
}

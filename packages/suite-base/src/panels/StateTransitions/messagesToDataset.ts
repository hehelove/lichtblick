// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import stringHash from "string-hash";

import { subtract as subtractTimes, toSec } from "@lichtblick/rostime";
import {
  MessageAndData,
  MessagePathDataItem,
} from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import { ChartDataset } from "@lichtblick/suite-base/components/TimeBasedChart/types";
import { expandedLineColors } from "@lichtblick/suite-base/util/plotColors";
import { getTimestampForMessageEvent } from "@lichtblick/suite-base/util/time";

import positiveModulo from "./positiveModulo";
import { dynamicSeriesIdentity, getDynamicFields } from "./shared";
import { DynamicMessageDatasetsArgs, MessageDatasetArgs, ValidQueriedDataValue } from "./types";

export const baseColors = [...expandedLineColors];
const baseColorsLength = Object.values(baseColors).length;

/**
 * Processes messages into datasets. For performance reasons all values are condensed into a single
 * dataset with different labels and colors applied per-point.
 */
export function messagesToDataset(args: MessageDatasetArgs): ChartDataset {
  const { path, startTime, y, blocks, showPoints, dynamicSeries } = args;

  const dataset: ChartDataset = {
    borderWidth: 10,
    data: [],
    label:
      dynamicSeries == undefined
        ? (path.label ?? path.value)
        : `${path.label ?? path.value} · ${dynamicSeries.label}`,
    pointBackgroundColor: "rgba(0, 0, 0, 0.4)",
    pointBorderColor: "transparent",
    pointHoverRadius: 3,
    pointRadius: showPoints ? 1.25 : 0,
    pointStyle: "circle",
    showLine: true,
  };

  let lastValue: string | number | bigint | boolean | undefined = undefined;
  let lastDatum: ChartDataset["data"][0] | undefined = undefined;
  let lastValidDatum: ChartDataset["data"][0] | undefined = undefined;

  for (const messages of blocks) {
    if (!messages) {
      continue;
    }

    for (const itemByPath of messages) {
      const timestamp = getTimestampForMessageEvent(itemByPath.messageEvent, path.timestampMethod);
      if (!timestamp) {
        continue;
      }
      const x = toSec(subtractTimes(timestamp, startTime));

      const queriedData = extractQueriedData(itemByPath);
      if (!queriedData) {
        continue;
      }

      const selectedData =
        dynamicSeries == undefined
          ? queriedData
          : extractDynamicData(queriedData.value, path, dynamicSeries.identity);
      if (selectedData == undefined || !isValidValue(selectedData.value)) {
        if (dynamicSeries != undefined && lastValue != undefined) {
          if (lastValidDatum != undefined) {
            dataset.data.push({ ...lastValidDatum, x, label: undefined });
          }
          dataset.data.push(undefined);
          lastValue = undefined;
          lastDatum = undefined;
          lastValidDatum = undefined;
        }
        continue;
      }

      const { constantName, value } = selectedData;

      const color = getColor(value);
      const label = createLabel(constantName, value);

      const isNewSegment = lastValue !== value;

      lastValue = value;
      lastDatum = {
        x,
        y,
        label: isNewSegment ? label : undefined,
        labelColor: color,
        value,
        constantName,
      };
      lastValidDatum = lastDatum;

      if (isNewSegment || showPoints) {
        dataset.data.push(lastDatum);

        // after we add a datum we clear the last datum so we don't try to add it again at the end
        lastDatum = undefined;
      }
    }
  }

  // If we never added the last datum (maybe because it was the same state as before), we add
  // it to the data so the user sees the state going until this point.
  if (lastDatum != undefined) {
    dataset.data.push(lastDatum);
  }

  return dataset;
}

type DynamicDatasetState = {
  dataset: ChartDataset;
  lastValue: ValidQueriedDataValue | undefined;
  lastDatum: ChartDataset["data"][0] | undefined;
  lastValidDatum: ChartDataset["data"][0] | undefined;
};

/** Builds every dynamic label dataset while scanning each message and object-array entry once. */
export function messagesToDynamicDatasets(args: DynamicMessageDatasetsArgs): ChartDataset[] {
  const { path, startTime, blocks, showPoints, dynamicSeries, yValues } = args;
  const { labelField, valueField } = getDynamicFields(path);
  const states = new Map<string, DynamicDatasetState>();
  const yByIdentity = new Map<string, number>();

  dynamicSeries.forEach((series, index) => {
    states.set(series.identity, {
      dataset: createDataset({
        pathLabel: path.label ?? path.value,
        showPoints,
        seriesLabel: series.label,
      }),
      lastValue: undefined,
      lastDatum: undefined,
      lastValidDatum: undefined,
    });
    const y = yValues[index];
    if (y != undefined) {
      yByIdentity.set(series.identity, y);
    }
  });

  const activeIdentities = new Set<string>();
  for (const messages of blocks) {
    for (const itemByPath of messages ?? []) {
      const timestamp = getTimestampForMessageEvent(itemByPath.messageEvent, path.timestampMethod);
      if (!timestamp) {
        continue;
      }
      const queriedData = extractQueriedData(itemByPath);
      if (!queriedData) {
        continue;
      }
      const x = toSec(subtractTimes(timestamp, startTime));
      const values = extractDynamicValues(queriedData.value, labelField, valueField);

      for (const identity of activeIdentities) {
        const selectedData = values.get(identity);
        if (selectedData == undefined || !isValidValue(selectedData.value)) {
          const state = states.get(identity)!;
          if (state.lastValidDatum != undefined) {
            state.dataset.data.push({ ...state.lastValidDatum, x, label: undefined });
          }
          state.dataset.data.push(undefined);
          state.lastValue = undefined;
          state.lastDatum = undefined;
          state.lastValidDatum = undefined;
          activeIdentities.delete(identity);
        }
      }

      for (const [identity, selectedData] of values) {
        const state = states.get(identity);
        if (state == undefined || !isValidValue(selectedData.value)) {
          continue;
        }
        const y = yByIdentity.get(identity);
        if (y == undefined) {
          continue;
        }
        appendDatum({ state, selectedData, x, y, showPoints });
        activeIdentities.add(identity);
      }
    }
  }

  for (const state of states.values()) {
    if (state.lastDatum != undefined) {
      state.dataset.data.push(state.lastDatum);
    }
  }
  return [...states.values()].map(({ dataset }) => dataset);
}

function createDataset({
  pathLabel,
  showPoints,
  seriesLabel,
}: {
  pathLabel: string;
  showPoints: boolean;
  seriesLabel: string;
}): ChartDataset {
  return {
    borderWidth: 10,
    data: [],
    label: `${pathLabel} · ${seriesLabel}`,
    pointBackgroundColor: "rgba(0, 0, 0, 0.4)",
    pointBorderColor: "transparent",
    pointHoverRadius: 3,
    pointRadius: showPoints ? 1.25 : 0,
    pointStyle: "circle",
    showLine: true,
  };
}

function extractDynamicValues(
  value: unknown,
  labelField: string,
  valueField: string,
): Map<string, MessagePathDataItem> {
  const result = new Map<string, MessagePathDataItem>();
  if (!Array.isArray(value)) {
    return result;
  }
  for (const entry of value) {
    if (typeof entry !== "object" || entry == undefined) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const label = record[labelField];
    if (isValidValue(label)) {
      const identity = dynamicSeriesIdentity(label);
      if (!result.has(identity)) {
        result.set(identity, { path: valueField, value: record[valueField] });
      }
    }
  }
  return result;
}

function appendDatum({
  state,
  selectedData,
  x,
  y,
  showPoints,
}: {
  state: DynamicDatasetState;
  selectedData: MessagePathDataItem;
  x: number;
  y: number;
  showPoints: boolean;
}): void {
  const { constantName, value } = selectedData;
  if (!isValidValue(value)) {
    return;
  }
  const color = getColor(value);
  const isNewSegment = state.lastValue !== value;
  state.lastValue = value;
  state.lastDatum = {
    x,
    y,
    label: isNewSegment ? createLabel(constantName, value) : undefined,
    labelColor: color,
    value,
    constantName,
  };
  state.lastValidDatum = state.lastDatum;
  if (isNewSegment || showPoints) {
    state.dataset.data.push(state.lastDatum);
    state.lastDatum = undefined;
  }
}

function extractDynamicData(
  value: unknown,
  path: MessageDatasetArgs["path"],
  identity: string,
): MessagePathDataItem | undefined {
  const { labelField, valueField } = getDynamicFields(path);
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const entry of value) {
    if (typeof entry !== "object" || entry == undefined) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const label = record[labelField];
    if (isValidValue(label) && dynamicSeriesIdentity(label) === identity) {
      return {
        path: `${path.value}.${valueField}`,
        value: record[valueField],
      };
    }
  }
  return undefined;
}

export function extractQueriedData(itemByPath: MessageAndData): MessagePathDataItem | undefined {
  if (itemByPath.queriedData.length === 1) {
    return itemByPath.queriedData[0];
  }
  return undefined;
}

export function isValidValue(value: unknown): value is number | string | bigint | boolean {
  // Check if the type of `value` is one of the desired types and that it's not `NaN`
  return (
    (typeof value === "number" && !Number.isNaN(value)) ||
    typeof value === "string" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  );
}

export function getColor(value: ValidQueriedDataValue): string {
  const valueForColor = typeof value === "string" ? stringHash(value) : Math.round(Number(value));
  return baseColors[positiveModulo(valueForColor, baseColorsLength)]!;
}

export function createLabel(
  constantName: string | undefined,
  value: ValidQueriedDataValue,
): string {
  return constantName != undefined ? `${constantName} (${String(value)})` : String(value);
}

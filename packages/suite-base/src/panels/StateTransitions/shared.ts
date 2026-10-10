// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Immutable } from "@lichtblick/suite";
import { MessageAndData } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";

import {
  DynamicStateTransitionSeries,
  ImmutableDataset,
  StateTransitionPath,
  ValidQueriedDataValue,
} from "./types";

function presence<T>(value: undefined | T): undefined | T {
  if (value === "") {
    return undefined;
  }

  return value ?? undefined;
}

export function stateTransitionPathDisplayName(
  path: Readonly<StateTransitionPath>,
  index: number,
): string {
  return presence(path.label) ?? presence(path.value) ?? `Series ${index + 1}`;
}

export function datasetContainsArray(dataset: ImmutableDataset): boolean {
  // We need to detect when the path produces more than one data point,
  // since that is invalid input
  const dataCounts = [
    ...new Set(
      dataset.flatMap((data: Immutable<MessageAndData[] | undefined>) =>
        data == undefined ? [] : data.map((message) => message.queriedData.length),
      ),
    ),
  ];
  return dataCounts.length > 0 && dataCounts.every((numPoints) => numPoints > 1);
}

export function dynamicSeriesIdentity(value: ValidQueriedDataValue): string {
  return `${typeof value}:${String(value)}`;
}

// Index-keyed rows use a prefix outside dynamicSeriesIdentity's `${typeof}:${value}` grammar
// (typeof is never "index"), so a numeric label 0 ("number:0") can never collide with "index:0".
export function dynamicIndexIdentity(index: number): string {
  return `index:${index}`;
}

/** An array is label-keyed when any object entry carries valid label and value primitives. */
export function isLabelKeyedArray(
  array: unknown[],
  labelField: string,
  valueField: string,
): boolean {
  return array.some(
    (entry) =>
      typeof entry === "object" &&
      entry != undefined &&
      isDynamicFieldValue((entry as Record<string, unknown>)[labelField]) &&
      isDynamicFieldValue((entry as Record<string, unknown>)[valueField]),
  );
}

/** Value of an index-keyed element: primitives are the value themselves, objects read valueField. */
export function dynamicIndexValue(entry: unknown, valueField: string): unknown {
  if (typeof entry === "object" && entry != undefined) {
    return (entry as Record<string, unknown>)[valueField];
  }
  return entry;
}

export function getDynamicFields(path: Readonly<StateTransitionPath>): {
  labelField: string;
  valueField: string;
} {
  return {
    labelField: presence(path.dynamicLabelField) ?? "label",
    valueField: presence(path.dynamicValueField) ?? "value",
  };
}

export function getDynamicSeries(
  dataset: ImmutableDataset,
  labelField: string,
  valueField: string,
): DynamicStateTransitionSeries[] {
  const result = new Map<string, DynamicStateTransitionSeries>();
  let maxIndex = -1;

  for (const messages of dataset) {
    for (const message of messages ?? []) {
      if (message.queriedData.length !== 1) {
        continue;
      }
      const array = message.queriedData[0]?.value;
      if (!Array.isArray(array)) {
        continue;
      }
      // All-or-nothing per array: a single valid label+value entry keeps the whole array
      // label-keyed (unlabeled entries dropped as before); otherwise every element becomes
      // one index-keyed row.
      if (!isLabelKeyedArray(array, labelField, valueField)) {
        maxIndex = Math.max(maxIndex, array.length - 1);
        continue;
      }
      for (const entry of array) {
        if (typeof entry !== "object" || entry == undefined) {
          continue;
        }
        const label = (entry as Record<string, unknown>)[labelField];
        const value = (entry as Record<string, unknown>)[valueField];
        if (!isDynamicFieldValue(label) || !isDynamicFieldValue(value)) {
          continue;
        }
        const identity = dynamicSeriesIdentity(label);
        if (!result.has(identity)) {
          result.set(identity, { identity, label: String(label) });
        }
      }
    }
  }
  // Index rows cover the longest index-fallback array seen across all messages.
  for (let index = 0; index <= maxIndex; index++) {
    const identity = dynamicIndexIdentity(index);
    result.set(identity, { identity, label: `[${index}]`, sourceIndex: index });
  }
  return [...result.values()];
}

function isDynamicFieldValue(value: unknown): value is ValidQueriedDataValue {
  return (
    (typeof value === "number" && !Number.isNaN(value)) ||
    typeof value === "string" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  );
}

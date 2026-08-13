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

  for (const messages of dataset) {
    for (const message of messages ?? []) {
      if (message.queriedData.length !== 1) {
        continue;
      }
      const array = message.queriedData[0]?.value;
      if (!Array.isArray(array)) {
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

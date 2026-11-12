// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time } from "@lichtblick/rostime";
import { Immutable, SettingsTreeAction, SettingsTreeNodeActionItem } from "@lichtblick/suite";
import { MessageAndData } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import { TimestampMethod } from "@lichtblick/suite-base/util/time";

export type StateTransitionPath = {
  color?: string;
  value: string;
  label?: string;
  dynamicLabelField?: string;
  dynamicValueField?: string;
  enabled?: boolean;
  timestampMethod: TimestampMethod;
};

export type DynamicStateTransitionSeries = {
  identity: string;
  label: string;
  // Element index for index-keyed rows (primitive arrays / objects without the label field).
  sourceIndex?: number;
};

export type StateTransitionConfig = {
  isSynced: boolean;
  paths: StateTransitionPath[];
  xAxisMaxValue?: number;
  xAxisMinValue?: number;
  xAxisRange?: number;
  xAxisLabel?: string;
  showPoints?: boolean;
};

export type StateTransitionPanelProps = {
  config: StateTransitionConfig;
  saveConfig: SaveConfig<StateTransitionConfig>;
};

export type PathLegendProps = {
  pathState: PathState[];
  heightPerRow: number;
  setFocusedPath: (value: string[] | undefined) => void;
  saveConfig: SaveConfig<StateTransitionConfig>;
};

export interface IUsePanelSettings {
  actionHandler: (action: SettingsTreeAction) => void;
}

export type PathState = {
  path: StateTransitionPath;
  // Whether the data the path refers to resolves to more than one value
  isArray: boolean;
  dynamicSeries?: DynamicStateTransitionSeries[];
};

export type AxisTreeField = {
  value: number | undefined;
  label: string;
  error?: string | undefined;
};

export type SeriesAction = Pick<SettingsTreeNodeActionItem, "label" | "icon" | "id">;

export enum SeriesActionId {
  ADD = "add-series",
  DELETE = "delete-series",
}

export type MessageDatasetArgs = {
  path: StateTransitionPath;
  startTime: Time;
  y: number;
  pathIndex: number;
  blocks: readonly (readonly MessageAndData[] | undefined)[];
  showPoints: boolean;
  dynamicSeries?: DynamicStateTransitionSeries;
};

export type DynamicMessageDatasetsArgs = Omit<MessageDatasetArgs, "dynamicSeries" | "y"> & {
  dynamicSeries: readonly DynamicStateTransitionSeries[];
  yValues: readonly number[];
};

export type ValidQueriedDataValue = number | string | boolean | bigint;

export type ValueAtTime = {
  value: ValidQueriedDataValue;
  constantName: string | undefined;
};

export type ImmutableDataset = Immutable<(MessageAndData[] | undefined)[]>;

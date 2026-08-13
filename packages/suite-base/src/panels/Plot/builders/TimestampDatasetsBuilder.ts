// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@lichtblick/comlink";
import { ComlinkWrap } from "@lichtblick/den/worker";
import { MessagePath } from "@lichtblick/message-path";
import { toSec, subtract as subtractTime } from "@lichtblick/rostime";
import { Immutable, MessageEvent, Time } from "@lichtblick/suite";
import { simpleGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { PlayerState } from "@lichtblick/suite-base/players/types";
import { TimestampMethod, getTimestampForMessage } from "@lichtblick/suite-base/util/time";

import {
  CsvDataset,
  GetViewportDatasetsResult,
  HandlePlayerStateResult,
  IDatasetsBuilder,
  SeriesItem,
  Viewport,
} from "./IDatasetsBuilder";
import type {
  DataItem,
  TimestampDatasetsBuilderImpl,
  UpdateDataAction,
} from "./TimestampDatasetsBuilderImpl";
import { buildCurrentSeriesActions, buildFullSeriesActions } from "./utils";
import { getChartValue, isChartValue } from "../utils/datum";
import { DynamicSeriesResolver, isDynamicSeries } from "../utils/dynamicSeries";
import { getMathFunction, MathFunction } from "../utils/mathFunctions";

// If the datasets builder is garbage collected we also need to cleanup the worker
// This registry ensures the worker is cleaned up when the builder is garbage collected
const registry = new FinalizationRegistry<() => void>((dispose) => {
  dispose();
});

const emptyPaths = new Set<string>();

type TimestampSeriesItem = {
  config: Immutable<SeriesItem>;
};

/**
 * TimestampDatasetsBuilder builds timeseries datasets.
 *
 * It supports full (preload) data and current frame data. The series datums are extracted from
 * input player states and sent to the worker. The worker accumulates the data and provides
 * downsampled data.
 */
export class TimestampDatasetsBuilder implements IDatasetsBuilder {
  #datasetsBuilderRemote: Comlink.Remote<Comlink.RemoteObject<TimestampDatasetsBuilderImpl>>;

  #pendingDispatch: Immutable<UpdateDataAction>[] = [];

  #lastSeekTime = 0;

  #series: Immutable<TimestampSeriesItem[]> = [];
  // True once handleMessageRange has been called — indicates a range-capable source (file/bag).
  // When true, handlePlayerState skips append-current since the full history comes from the range.
  #hasRangeSource = false;
  readonly #dynamicResolver = new DynamicSeriesResolver();

  public constructor() {
    const worker = new Worker(
      // foxglove-depcheck-used: babel-plugin-transform-import-meta
      new URL("./TimestampDatasetsBuilderImpl.worker", import.meta.url),
    );
    const { remote, dispose } =
      ComlinkWrap<Comlink.RemoteObject<TimestampDatasetsBuilderImpl>>(worker);
    this.#datasetsBuilderRemote = remote;

    registry.register(this, dispose);
  }

  public handlePlayerState(state: Immutable<PlayerState>): HandlePlayerStateResult | undefined {
    const activeData = state.activeData;
    if (!activeData) {
      return;
    }

    const didSeek = activeData.lastSeekTime !== this.#lastSeekTime;
    this.#lastSeekTime = activeData.lastSeekTime;

    const msgEvents = activeData.messages;
    let datasetsChanged = false;
    if (!this.#hasRangeSource && msgEvents.length > 0) {
      const staticSeries = this.#series.filter(({ config }) => !isDynamicSeries(config));
      const { actions: seriesActions, datasetsChanged: seriesChanged } = buildCurrentSeriesActions(
        staticSeries,
        { didSeek, hasRangeSource: this.#hasRangeSource },
        (config) => {
          const mathFn = getMathFunction(config.parsed.modifier);
          return readMessagePathItems(
            msgEvents,
            config.parsed,
            config.timestampMethod,
            activeData.startTime,
            mathFn,
          );
        },
      );
      this.#pendingDispatch.push(...(seriesActions as UpdateDataAction[]));
      datasetsChanged ||= seriesChanged;
      datasetsChanged ||= this.#appendDynamicMessages(
        msgEvents,
        activeData.startTime,
        didSeek ? "reset-current" : undefined,
        "append-current",
      );
    }

    return {
      range: { min: 0, max: toSec(subtractTime(activeData.endTime, activeData.startTime)) },
      datasetsChanged,
    };
  }

  public handleMessageRange(
    messages: Immutable<MessageEvent[]>,
    options: { isReset: boolean },
    startTime: Immutable<Time>,
  ): void {
    this.#hasRangeSource = true;
    const topic = messages[0]?.topic;
    if (!topic) {
      return;
    }

    const staticSeries = this.#series.filter(({ config }) => !isDynamicSeries(config));
    const actions = buildFullSeriesActions(staticSeries, topic, options, (config) => {
      const mathFn = getMathFunction(config.parsed.modifier);
      return readMessagePathItems(
        messages,
        config.parsed,
        config.timestampMethod,
        startTime,
        mathFn,
      );
    });
    this.#pendingDispatch.push(...(actions as UpdateDataAction[]));
    this.#appendDynamicMessages(
      messages,
      startTime,
      options.isReset ? "reset-full" : undefined,
      "append-full",
    );
  }

  public setSeries(series: Immutable<SeriesItem[]>): void {
    this.#series = series.map((item) => ({ config: item }));
    this.#dynamicResolver.setSeries(series);
    this.#pendingDispatch.push({
      type: "update-series-config",
      seriesItems: this.#dynamicResolver.getSeries(),
    });
  }

  public setDynamicSeriesEnabled(identity: string, options: { enabled: boolean }): void {
    this.#dynamicResolver.setEnabled(identity, options);
    this.#pendingDispatch.push({
      type: "update-series-config",
      seriesItems: this.#dynamicResolver.getSeries(),
    });
  }

  public getDynamicSeries(): Immutable<SeriesItem[]> {
    return this.#dynamicResolver.getSeries().filter((item) => item.compositeKey != undefined);
  }

  #appendDynamicMessages(
    events: Immutable<MessageEvent[]>,
    startTime: Immutable<Time>,
    resetType: "reset-current" | "reset-full" | undefined,
    appendType: "append-current" | "append-full",
  ): boolean {
    let changed = false;
    const actions: UpdateDataAction[] = [];
    for (const { config } of this.#series) {
      const itemsByKey = new Map<SeriesItem["key"], DataItem[]>();
      for (const event of events) {
        if (event.topic !== config.parsed.topicName) {
          continue;
        }
        const timestamp =
          config.timestampMethod === "receiveTime"
            ? event.receiveTime
            : getTimestampForMessage(event.message);
        if (!timestamp) {
          continue;
        }
        const values = new Map<string, ReturnType<DynamicSeriesResolver["resolve"]>[number]>();
        for (const item of simpleGetMessagePathDataItems(event, config.parsed)) {
          for (const value of this.#dynamicResolver.resolve(config, item)) {
            values.set(value.identity, value);
          }
        }
        if (!isDynamicSeries(config) && values.size === 0) {
          continue;
        }
        const x = toSec(subtractTime(timestamp, startTime));
        for (const child of this.#dynamicResolver.getChildren(config.key)) {
          const value = values.get(child.compositeKey!);
          const y = value?.value ?? NaN;
          const items = itemsByKey.get(child.key) ?? [];
          items.push({
            x,
            y,
            value: y,
            receiveTime: event.receiveTime,
            headerStamp: getTimestampForMessage(event.message),
          });
          itemsByKey.set(child.key, items);
        }
      }
      for (const child of this.#dynamicResolver.getChildren(config.key)) {
        if (resetType) {
          actions.push({ type: resetType, series: child.key });
        }
        const items = itemsByKey.get(child.key) ?? [];
        if (items.length > 0) {
          actions.push({ type: appendType, series: child.key, items });
          changed = true;
        }
      }
    }
    if (actions.length > 0) {
      this.#pendingDispatch.push(
        { type: "update-series-config", seriesItems: this.#dynamicResolver.getSeries() },
        ...actions,
      );
    }
    return changed;
  }

  public async getViewportDatasets(
    viewport: Immutable<Viewport>,
  ): Promise<GetViewportDatasetsResult> {
    const dispatch = this.#pendingDispatch;
    if (dispatch.length > 0) {
      this.#pendingDispatch = [];
      await this.#datasetsBuilderRemote.applyActions(dispatch);
    }

    const datasets = await this.#datasetsBuilderRemote.getViewportDatasets(viewport);
    return { datasetsByConfigIndex: datasets, pathsWithMismatchedDataLengths: emptyPaths };
  }

  public async getCsvData(): Promise<CsvDataset[]> {
    return await this.#datasetsBuilderRemote.getCsvData();
  }
}

function readMessagePathItems(
  events: Immutable<MessageEvent[]>,
  path: Immutable<MessagePath>,
  timestampMethod: TimestampMethod,
  startTime: Immutable<Time>,
  mathFunction?: MathFunction,
): DataItem[] {
  const out = [];
  for (const event of events) {
    if (event.topic !== path.topicName) {
      continue;
    }

    const items = simpleGetMessagePathDataItems(event, path);
    for (const item of items) {
      if (mathFunction) {
        const headerStamp = getTimestampForMessage(event.message);
        const timestamp = timestampMethod === "receiveTime" ? event.receiveTime : headerStamp;
        if (!timestamp) {
          continue;
        }
        const xValue = toSec(subtractTime(timestamp, startTime));
        const mathModified = mathFunction(item);
        out.push({
          x: xValue,
          y: mathModified,
          receiveTime: event.receiveTime,
          headerStamp,
          value: mathModified,
        });
        continue;
      }

      if (!isChartValue(item)) {
        continue;
      }
      const chartValue = getChartValue(item);
      if (chartValue == undefined) {
        continue;
      }

      const headerStamp = getTimestampForMessage(event.message);
      const timestamp = timestampMethod === "receiveTime" ? event.receiveTime : headerStamp;
      if (!timestamp) {
        continue;
      }

      const xValue = toSec(subtractTime(timestamp, startTime));
      out.push({
        x: xValue,
        y: chartValue,
        receiveTime: event.receiveTime,
        headerStamp,
        value: item,
      });
    }
  }

  return out;
}

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@lichtblick/comlink";
import { ComlinkWrap } from "@lichtblick/den/worker";
import { MessagePath } from "@lichtblick/message-path";
import { Immutable, MessageEvent } from "@lichtblick/suite";
import { simpleGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { Bounds1D } from "@lichtblick/suite-base/components/TimeBasedChart/types";
import { PlayerState } from "@lichtblick/suite-base/players/types";
import { extendBounds1D, unionBounds1D } from "@lichtblick/suite-base/types/Bounds";

import {
  CustomDatasetsBuilderImpl,
  UpdateDataAction,
  ValueItem,
} from "./CustomDatasetsBuilderImpl";
import {
  CsvDataset,
  GetViewportDatasetsResult,
  HandlePlayerStateResult,
  IDatasetsBuilder,
  SeriesItem,
  Viewport,
} from "./IDatasetsBuilder";
import { buildCurrentSeriesActions, buildFullSeriesActions } from "./utils";
import { resolveChartDatum } from "../utils/datum";
import { DynamicSeriesResolver, isDynamicSeries } from "../utils/dynamicSeries";
import { getMathFunction, MathFunction } from "../utils/mathFunctions";

type CustomDatasetsSeriesItem = {
  config: Immutable<SeriesItem>;
};

// If the datasets builder is garbage collected we also need to cleanup the worker
// This registry ensures the worker is cleaned up when the builder is garbage collected
const registry = new FinalizationRegistry<() => void>((dispose) => {
  dispose();
});

export class CustomDatasetsBuilder implements IDatasetsBuilder {
  readonly #datasetsBuilderRemote: Comlink.Remote<Comlink.RemoteObject<CustomDatasetsBuilderImpl>>;
  #xParsedPath?: Immutable<MessagePath>;

  #pendingDispatch: Immutable<UpdateDataAction>[] = [];

  #lastSeekTime = 0;

  #series: Immutable<CustomDatasetsSeriesItem[]> = [];

  #xCurrentBounds?: Bounds1D;
  #xFullBounds?: Bounds1D;

  #hasRangeSource: boolean = false;
  readonly #dynamicResolver = new DynamicSeriesResolver();
  readonly #dynamicCurrentCount = new Map<SeriesItem["key"], number>();
  readonly #dynamicFullCount = new Map<SeriesItem["key"], number>();

  public getXTopic(): string | undefined {
    return this.#xParsedPath?.topicName;
  }

  public constructor() {
    const worker = new Worker(
      // foxglove-depcheck-used: babel-plugin-transform-import-meta
      new URL("./CustomDatasetsBuilderImpl.worker", import.meta.url),
    );
    const { remote, dispose } =
      ComlinkWrap<Comlink.RemoteObject<CustomDatasetsBuilderImpl>>(worker);

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

    let datasetsChanged = false;

    const msgEvents = activeData.messages;
    if (!this.#hasRangeSource && msgEvents.length > 0) {
      // Read the x-axis values.
      // No reset on seek: without a range source, accumulated x-axis data is irrecoverable
      // (same reasoning as y-axis series in buildCurrentSeriesActions).
      if (this.#xParsedPath) {
        const pathItems = parseXPathItems(msgEvents, this.#xParsedPath);

        this.#pendingDispatch.push({
          type: "append-current-x",
          items: pathItems,
        });

        if (pathItems.length > 0) {
          datasetsChanged = true;
          this.#xCurrentBounds = computeBounds(this.#xCurrentBounds, pathItems);
        }
      }

      const staticSeries = this.#series.filter(({ config }) => !isDynamicSeries(config));
      const { actions: seriesActions, datasetsChanged: seriesChanged } = buildCurrentSeriesActions(
        staticSeries,
        { didSeek, hasRangeSource: this.#hasRangeSource },
        (config) => {
          const mathFn = getMathFunction(config.parsed.modifier);
          return readMessagePathItems(msgEvents, config.parsed, mathFn);
        },
      );
      this.#pendingDispatch.push(...(seriesActions as UpdateDataAction[]));
      datasetsChanged ||= seriesChanged;
      const dynamicChanged = this.#appendDynamicMessages(
        msgEvents,
        didSeek ? "reset-current" : undefined,
        "append-current",
      );
      datasetsChanged ||= dynamicChanged;
    }

    if (!this.#xCurrentBounds) {
      return {
        range: this.#xFullBounds ?? { min: 0, max: 1 },
        datasetsChanged,
      };
    }

    if (!this.#xFullBounds) {
      return {
        range: this.#xCurrentBounds,
        datasetsChanged,
      };
    }

    return {
      range: unionBounds1D(this.#xCurrentBounds, this.#xFullBounds),
      datasetsChanged,
    };
  }

  public handleMessageRange(
    messages: Immutable<MessageEvent[]>,
    options: { isReset: boolean },
  ): void {
    this.#hasRangeSource = true;
    const topic = messages[0]?.topic;
    if (!topic) {
      return;
    }

    const isXBatch = topic === this.#xParsedPath?.topicName;

    if (isXBatch) {
      if (options.isReset) {
        this.#pendingDispatch.push({ type: "reset-full-x" });
        this.#xFullBounds = undefined;
      }
      if (this.#xParsedPath) {
        const pathItems = parseXPathItems(messages, this.#xParsedPath);
        if (pathItems.length > 0) {
          this.#xFullBounds = computeBounds(this.#xFullBounds, pathItems);
          this.#pendingDispatch.push({ type: "append-full-x", items: pathItems });
        }
      }
      return;
    }

    const staticSeries = this.#series.filter(({ config }) => !isDynamicSeries(config));
    const actions = buildFullSeriesActions(staticSeries, topic, options, (config) => {
      const mathFn = getMathFunction(config.parsed.modifier);
      return readMessagePathItems(messages, config.parsed, mathFn);
    });
    this.#pendingDispatch.push(...(actions as UpdateDataAction[]));
    this.#appendDynamicMessages(
      messages,
      options.isReset ? "reset-full" : undefined,
      "append-full",
    );
  }

  public setXPath(path: Immutable<MessagePath> | undefined): void {
    if (JSON.stringify(path) === JSON.stringify(this.#xParsedPath)) {
      return;
    }

    this.#xParsedPath = path;
    this.#xFullBounds = undefined;
    this.#xCurrentBounds = undefined;

    this.#pendingDispatch.push({
      type: "reset-current-x",
    });

    this.#pendingDispatch.push({
      type: "reset-full-x",
    });
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
    resetType: "reset-current" | "reset-full" | undefined,
    appendType: "append-current" | "append-full",
  ): boolean {
    const actions: UpdateDataAction[] = [];
    let changed = false;
    for (const { config } of this.#series) {
      const itemsByKey = new Map<SeriesItem["key"], ValueItem[]>();
      const countByParent =
        appendType === "append-current" ? this.#dynamicCurrentCount : this.#dynamicFullCount;
      if (resetType) {
        countByParent.set(config.key, 0);
      }
      const previousCount = countByParent.get(config.key) ?? 0;
      let appendedCount = 0;
      for (const event of events) {
        if (event.topic !== config.parsed.topicName) {
          continue;
        }
        for (const item of simpleGetMessagePathDataItems(event, config.parsed)) {
          const resolved = this.#dynamicResolver.resolve(config, item);
          if (!isDynamicSeries(config) && resolved.length === 0) {
            continue;
          }
          const slotCount = Array.isArray(item) ? item.length : 0;
          const valuesByIdentity = new Map(resolved.map((value) => [value.identity, value]));
          for (const child of this.#dynamicResolver.getChildren(config.key)) {
            const items =
              itemsByKey.get(child.key) ??
              Array.from({ length: previousCount + appendedCount }, () => ({
                value: NaN,
                originalValue: NaN,
                receiveTime: event.receiveTime,
              }));
            const childValue = valuesByIdentity.get(child.compositeKey!);
            for (let sourceIndex = 0; sourceIndex < slotCount; sourceIndex++) {
              const value = childValue?.sourceIndex === sourceIndex ? childValue.value : NaN;
              items.push({ value, originalValue: value, receiveTime: event.receiveTime });
            }
            itemsByKey.set(child.key, items);
          }
          appendedCount += slotCount;
        }
      }
      countByParent.set(config.key, previousCount + appendedCount);
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
      await this.#datasetsBuilderRemote.updateData(dispatch);
    }

    return await this.#datasetsBuilderRemote.getViewportDatasets(viewport);
  }

  public async getCsvData(): Promise<CsvDataset[]> {
    return await this.#datasetsBuilderRemote.getCsvData();
  }
}

function parseXPathItems(
  messages: Immutable<MessageEvent[]>,
  xParsedPath: Immutable<MessagePath>,
): ValueItem[] {
  const mathFn = getMathFunction(xParsedPath.modifier);
  return readMessagePathItems(messages, xParsedPath, mathFn);
}

function readMessagePathItems(
  events: Immutable<MessageEvent[]>,
  path: Immutable<MessagePath>,
  mathFunction?: MathFunction,
): ValueItem[] {
  const out = [];
  for (const event of events) {
    if (event.topic !== path.topicName) {
      continue;
    }

    const items = simpleGetMessagePathDataItems(event, path);
    for (const item of items) {
      const datum = resolveChartDatum(item, mathFunction);
      if (!datum) {
        continue;
      }

      out.push({
        value: datum.y,
        originalValue: datum.value,
        receiveTime: event.receiveTime,
      });
    }
  }

  return out;
}

function accumulateBounds(acc: Bounds1D, item: Immutable<ValueItem>) {
  extendBounds1D(acc, item.value);
  return acc;
}

function computeBounds(
  currentBounds: Immutable<Bounds1D> | undefined,
  items: Immutable<ValueItem[]>,
): Bounds1D {
  const itemBounds = items.reduce(accumulateBounds, {
    min: Number.MAX_VALUE,
    max: Number.MIN_VALUE,
  });

  return unionBounds1D(
    currentBounds ?? { min: Number.MAX_VALUE, max: Number.MIN_VALUE },
    itemBounds,
  );
}

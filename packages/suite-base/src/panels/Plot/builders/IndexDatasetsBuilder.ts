// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { filterMap } from "@lichtblick/den/collection";
import { Immutable } from "@lichtblick/suite";
import { simpleGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { Bounds1D } from "@lichtblick/suite-base/components/TimeBasedChart/types";
import { PlayerState } from "@lichtblick/suite-base/players/types";

import {
  CsvDataset,
  GetViewportDatasetsResult,
  HandlePlayerStateResult,
  IDatasetsBuilder,
  SeriesConfigKey,
  SeriesItem,
} from "./IDatasetsBuilder";
import { CurrentFrameSeriesItem } from "./types";
import { buildViewportDatasets, lastMatchingTopic, setSeries } from "./utils";
import { resolveChartDatum } from "../utils/datum";
import { DynamicSeriesResolver, isDynamicSeries } from "../utils/dynamicSeries";
import { getMathFunction } from "../utils/mathFunctions";

export class IndexDatasetsBuilder implements IDatasetsBuilder {
  #seriesByKey = new Map<SeriesConfigKey, CurrentFrameSeriesItem>();

  #range?: Bounds1D;
  readonly #dynamicResolver = new DynamicSeriesResolver();
  #parents: Immutable<SeriesItem[]> = [];

  public handlePlayerState(state: Immutable<PlayerState>): HandlePlayerStateResult | undefined {
    const activeData = state.activeData;
    if (!activeData) {
      return;
    }

    const msgEvents = activeData.messages;
    if (msgEvents.length === 0) {
      // When there are no new messages we keep returning the same bounds as before since our
      // datasets have not changed.
      return {
        range: this.#range,
        datasetsChanged: false,
      };
    }

    const range: Bounds1D = { min: 0, max: 0 };
    let datasetsChanged = false;
    for (const series of this.#seriesByKey.values()) {
      const mathFn = getMathFunction(series.parsed.modifier, Number(series.parsed.modifierOperand?.value));

      const msgEvent = lastMatchingTopic(msgEvents, series.parsed.topicName);
      if (!msgEvent) {
        continue;
      }

      // If there is an input message for the series, we consider the datasets changed regardless of
      // how many points might be produced.
      datasetsChanged = true;

      const items = simpleGetMessagePathDataItems(msgEvent, series.parsed);
      const pathItems = filterMap(items, (item, idx) => {
        const datum = resolveChartDatum(item, mathFn);
        if (!datum) {
          return;
        }

        return {
          x: idx,
          y: datum.y,
          receiveTime: msgEvent.receiveTime,
          value: datum.value,
        };
      });

      series.dataset.data = pathItems;
      range.max = Math.max(range.max, series.dataset.data.length - 1);
    }
    // Dynamic parents are not present in #seriesByKey until their labels are discovered.
    for (const parent of this.#parents) {
      const msgEvent = lastMatchingTopic(msgEvents, parent.parsed.topicName);
      if (!msgEvent) {
        continue;
      }
      const values = new Map<string, ReturnType<DynamicSeriesResolver["resolve"]>[number]>();
      for (const item of simpleGetMessagePathDataItems(msgEvent, parent.parsed)) {
        for (const value of this.#dynamicResolver.resolve(parent, item)) {
          values.set(value.identity, value);
        }
      }
      if (!isDynamicSeries(parent) && values.size === 0) {
        continue;
      }
      this.#seriesByKey = setSeries(this.#seriesByKey, this.#dynamicResolver.getSeries());
      for (const child of this.#dynamicResolver.getChildren(parent.key)) {
        const series = this.#seriesByKey.get(child.key)!;
        const value = values.get(child.compositeKey!);
        series.dataset.data = value
          ? [
              {
                x: value.sourceIndex,
                y: value.value,
                value: value.value,
                receiveTime: msgEvent.receiveTime,
              },
            ]
          : [];
        range.max = Math.max(range.max, value?.sourceIndex ?? 0);
      }
      datasetsChanged = true;
    }

    this.#range = range;
    return {
      range: this.#range,
      datasetsChanged,
    };
  }

  public setSeries(series: Immutable<SeriesItem[]>): void {
    this.#parents = series;
    this.#dynamicResolver.setSeries(series);
    this.#seriesByKey = setSeries(this.#seriesByKey, this.#dynamicResolver.getSeries());
  }

  public setDynamicSeriesEnabled(identity: string, options: { enabled: boolean }): void {
    this.#dynamicResolver.setEnabled(identity, options);
    this.#seriesByKey = setSeries(this.#seriesByKey, this.#dynamicResolver.getSeries());
  }

  public getDynamicSeries(): Immutable<SeriesItem[]> {
    return this.#dynamicResolver.getSeries().filter((item) => item.compositeKey != undefined);
  }

  // We don't use the viewport because we do not do any downsampling on the assumption that
  // one message won't produce so many points that we need to downsample.
  //
  // If that assumption changes then downsampling can be revisited.
  public async getViewportDatasets(): Promise<GetViewportDatasetsResult> {
    return buildViewportDatasets(this.#seriesByKey);
  }

  public async getCsvData(): Promise<CsvDataset[]> {
    const datasets: CsvDataset[] = [];
    for (const series of this.#seriesByKey.values()) {
      if (!series.enabled) {
        continue;
      }

      datasets.push({
        label: series.messagePath,
        data: series.dataset.data,
      });
    }

    return datasets;
  }
}

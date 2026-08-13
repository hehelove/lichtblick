// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { unwrap } from "@lichtblick/den/monads";
import { parseMessagePath } from "@lichtblick/message-path";
import {
  PlayerPresence,
  PlayerState,
  PlayerStateActiveData,
} from "@lichtblick/suite-base/players/types";

import { SeriesConfigKey, SeriesItem } from "./IDatasetsBuilder";
import { IndexDatasetsBuilder } from "./IndexDatasetsBuilder";
import { PlotPath } from "../utils/config";

function buildSeriesItems(
  paths: (Partial<PlotPath> & { key?: string; value: string })[],
): SeriesItem[] {
  return paths.map((item, idx) => {
    const parsed = unwrap(parseMessagePath(item.value));
    const key = (item.key ?? String(idx)) as SeriesConfigKey;

    return {
      configIndex: idx,
      parsed,
      color: "red",
      contrastColor: "blue",
      enabled: item.enabled ?? true,
      timestampMethod: item.timestampMethod ?? "receiveTime",
      key,
      lineSize: 1,
      messagePath: item.value,
      showLine: true,
      dynamicLabelField: item.dynamicLabelField,
      dynamicValueField: item.dynamicValueField,
    } satisfies SeriesItem;
  });
}

function buildPlayerState(activeDataOverride?: Partial<PlayerStateActiveData>): PlayerState {
  return {
    activeData: {
      messages: [],
      currentTime: { sec: 0, nsec: 0 },
      endTime: { sec: 0, nsec: 0 },
      lastSeekTime: 1,
      topics: [],
      speed: 1,
      isPlaying: false,
      topicStats: new Map(),
      startTime: { sec: 0, nsec: 0 },
      datatypes: new Map(),
      totalBytesReceived: 0,
      ...activeDataOverride,
    },
    capabilities: [],
    presence: PlayerPresence.PRESENT,
    profile: undefined,
    playerId: "1",
    progress: {
      fullyLoadedFractionRanges: [],
    },
  };
}

describe("IndexDatasetsBuilder", () => {
  it("expands an object array into dynamic datasets", async () => {
    const builder = new IndexDatasetsBuilder();
    builder.setSeries(buildSeriesItems([{ value: "/bar.values" }]));
    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/bar",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              values: [
                { label: "a", value: 4 },
                { label: "b", value: 5 },
              ],
            },
          },
        ],
      }),
    );

    const result = await builder.getViewportDatasets();
    expect(result.datasetsByConfigIndex).toEqual([
      expect.objectContaining({ label: "a", data: [expect.objectContaining({ x: 0, y: 4 })] }),
      expect.objectContaining({ label: "b", data: [expect.objectContaining({ x: 1, y: 5 })] }),
    ]);
  });

  it("keeps dynamic children separate when a regular series is added later", async () => {
    const builder = new IndexDatasetsBuilder();
    builder.setSeries(buildSeriesItems([{ value: "/bar.values" }]));
    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/bar",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              values: [
                { label: "a", value: 4 },
                { label: "b", value: 5 },
              ],
            },
          },
        ],
      }),
    );

    builder.setSeries(
      buildSeriesItems([{ value: "/bar.values" }, { value: "/bar.regular", key: "regular" }]),
    );

    const result = await builder.getViewportDatasets();
    expect(result.datasetsByConfigIndex).toEqual([
      expect.objectContaining({ label: "a" }),
      expect.objectContaining({ label: undefined }),
      expect.objectContaining({ label: "b" }),
    ]);
  });
  it("should produce a dataset", async () => {
    const builder = new IndexDatasetsBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val",
        },
      ]),
    );

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/bar",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: -3,
            },
          },
        ],
      }),
    );

    const result = await builder.getViewportDatasets();

    expect(result).toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [{ x: 0, y: -3, value: -3, receiveTime: { sec: 0, nsec: 0 } }],
          showLine: true,
          pointRadius: 1.2,
          fill: false,
        }),
      ],
    });
  });

  it("should return the existing dataset range when no input messages", async () => {
    const builder = new IndexDatasetsBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val[:]",
        },
      ]),
    );

    const result = builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/bar",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: [1, 2, 3],
            },
          },
        ],
      }),
    );

    const secondResult = builder.handlePlayerState(
      buildPlayerState({
        messages: [],
      }),
    );

    expect(secondResult).toEqual({
      range: result?.range,
      datasetsChanged: false,
    });
  });

  it("should apply a math function", async () => {
    const builder = new IndexDatasetsBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val.@abs",
        },
      ]),
    );

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/bar",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: -3,
            },
          },
        ],
      }),
    );

    const result = await builder.getViewportDatasets();

    expect(result).toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [{ x: 0, y: 3, value: 3, receiveTime: { sec: 0, nsec: 0 } }],
          showLine: true,
          pointRadius: 1.2,
          fill: false,
        }),
      ],
    });
  });

  it("preserves scalar conversions when applying math modifiers", async () => {
    const builder = new IndexDatasetsBuilder();
    builder.setSeries(buildSeriesItems([{ value: "/bar.values[:].@abs" }]));
    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/bar",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: { values: [-2n, true, "3"] },
          },
        ],
      }),
    );

    const result = await builder.getViewportDatasets();
    expect(result.datasetsByConfigIndex[0]?.data.map(({ y }) => y)).toEqual([2, 1, 3]);
  });

  it("should apply an object math function", async () => {
    const builder = new IndexDatasetsBuilder();
    builder.setSeries(buildSeriesItems([{ value: "/bar.vector.@norm" }]));

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/bar",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: { vector: { x: 3, y: 4 } },
          },
        ],
      }),
    );

    await expect(builder.getViewportDatasets()).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [{ x: 0, y: 5, value: 5, receiveTime: { sec: 0, nsec: 0 } }],
        }),
      ],
    });
  });

  it("drops dynamic children and their data when the field config changes", async () => {
    const builder = new IndexDatasetsBuilder();
    builder.setSeries(
      buildSeriesItems([{ key: "label-key", value: "/bar.values", dynamicLabelField: "label" }]),
    );
    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/bar",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: { values: [{ label: "old", value: 4 }] },
          },
        ],
      }),
    );
    expect(builder.getDynamicSeries()).toHaveLength(1);

    builder.setSeries(
      buildSeriesItems([{ key: "name-key", value: "/bar.values", dynamicLabelField: "name" }]),
    );

    expect(builder.getDynamicSeries()).toEqual([]);
    await expect(builder.getViewportDatasets()).resolves.toEqual({
      datasetsByConfigIndex: [],
      pathsWithMismatchedDataLengths: new Set(),
    });
  });

  it("supports toggling series enabled state", async () => {
    const builder = new IndexDatasetsBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val[:]",
        },
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val[:]",
        },
      ]),
    );

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: [1, 2],
            },
          },
          {
            topic: "/bar",
            schemaName: "bar",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: [3, 4, 5],
            },
          },
        ],
      }),
    );

    await expect(builder.getViewportDatasets()).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 0, y: 1, value: 1, receiveTime: { sec: 0, nsec: 0 } },
            { x: 1, y: 2, value: 2, receiveTime: { sec: 0, nsec: 0 } },
          ],
        }),
        expect.objectContaining({
          data: [
            { x: 0, y: 3, value: 3, receiveTime: { sec: 0, nsec: 0 } },
            { x: 1, y: 4, value: 4, receiveTime: { sec: 0, nsec: 0 } },
            { x: 2, y: 5, value: 5, receiveTime: { sec: 0, nsec: 0 } },
          ],
        }),
      ],
    });

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: false,
          timestampMethod: "receiveTime",
          value: "/foo.val[:]",
        },
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val[:]",
        },
      ]),
    );

    await expect(builder.getViewportDatasets()).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        undefined,
        expect.objectContaining({
          data: [
            { x: 0, y: 3, value: 3, receiveTime: { sec: 0, nsec: 0 } },
            { x: 1, y: 4, value: 4, receiveTime: { sec: 0, nsec: 0 } },
            { x: 2, y: 5, value: 5, receiveTime: { sec: 0, nsec: 0 } },
          ],
        }),
      ],
    });
  });

  it("leaves gaps in datasetsByConfigIndex for missing series", async () => {
    const builder = new IndexDatasetsBuilder();

    builder.setSeries([
      {
        configIndex: 3,
        parsed: parseMessagePath("/foo.val")!,
        color: "red",
        contrastColor: "blue",
        enabled: true,
        timestampMethod: "receiveTime",
        key: "x" as SeriesConfigKey,
        lineSize: 1,
        messagePath: "/foo.val",
        showLine: true,
      },
    ]);

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1,
            },
          },
        ],
      }),
    );

    await expect(builder.getViewportDatasets()).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        undefined,
        undefined,
        undefined,
        expect.objectContaining({
          data: [{ x: 0, y: 1, value: 1, receiveTime: { sec: 0, nsec: 0 } }],
        }),
      ],
    });
  });
});

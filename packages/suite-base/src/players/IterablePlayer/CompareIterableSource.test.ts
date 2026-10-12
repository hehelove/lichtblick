/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { compare } from "@lichtblick/rostime";

import { CompareIterableSource } from "./CompareIterableSource";
import { IDeserializedIterableSource, Initialization } from "./IIterableSource";

function fakeInit(overrides: Partial<Initialization> = {}): Initialization {
  return {
    start: { sec: 100, nsec: 0 },
    end: { sec: 200, nsec: 0 },
    topics: [{ name: "/tf", schemaName: "tf2_msgs/TFMessage" }],
    topicStats: new Map([["/tf", { numMessages: 5 }]]),
    datatypes: new Map([
      [
        "tf2_msgs/TFMessage",
        {
          name: "tf2_msgs/TFMessage",
          definitions: [{ name: "x", type: "float64" }],
        },
      ],
    ]),
    profile: "ros2",
    publishersByTopic: new Map(),
    alerts: [],
    ...overrides,
  };
}

function makeFakeSource(init: Initialization): IDeserializedIterableSource {
  return {
    sourceType: "deserialized",
    initialize: async () => init,
    // Task 4 会替换为可产出消息的版本;本任务用例只测 initialize
    async *messageIterator() {},
    getBackfillMessages: async () => [],
  };
}

function makeSource(
  slots: Array<{ slot: string; fileName: string; init: Initialization }>,
  offsets?: Map<string, bigint>,
) {
  return new CompareIterableSource({
    slots: slots.map((s) => ({
      source: makeFakeSource(s.init),
      slot: s.slot,
      fileName: s.fileName,
    })),
    offsets: offsets ?? new Map(),
  });
}

describe("CompareIterableSource.initialize", () => {
  it("suffixes every topic, topicStats entry with the slot letter and joins file names", async () => {
    const source = makeSource([
      { slot: "A", fileName: "a.mcap", init: fakeInit() },
      { slot: "B", fileName: "b.bag", init: fakeInit() },
    ]);
    const init = await source.initialize();
    expect(init.topics.map((t) => t.name).sort()).toEqual(["/tf@A", "/tf@B"]);
    expect([...init.topicStats.keys()].sort()).toEqual(["/tf@A", "/tf@B"]);
    expect(init.name).toEqual("Comparison: a.mcap, b.bag");
  });

  it("computes elapsed start/end: start = min(offsets), end = max(duration + offset), negative offsets re-anchor", async () => {
    // A: child [100,200] anchor 100, offset -50n s => slot range [-50, +50]
    // B: child [100,300] anchor 100, offset 0   => slot range [0, 200]
    const source = makeSource(
      [
        { slot: "A", fileName: "a.mcap", init: fakeInit() },
        {
          slot: "B",
          fileName: "b.mcap",
          init: fakeInit({ end: { sec: 300, nsec: 0 } }),
        },
      ],
      new Map([["A", -50_000_000_000n]]),
    );
    const init = await source.initialize();
    expect(compare(init.start, { sec: -50, nsec: 0 })).toEqual(0);
    expect(compare(init.end, { sec: 200, nsec: 0 })).toEqual(0);
  });

  it("merges structurally equal datatypes silently and warns on conflicting definitions", async () => {
    const conflicting = fakeInit({
      datatypes: new Map([
        [
          "tf2_msgs/TFMessage",
          {
            name: "tf2_msgs/TFMessage",
            definitions: [{ name: "y", type: "float64" }],
          },
        ],
      ]),
    });
    const source = makeSource([
      { slot: "A", fileName: "a.mcap", init: fakeInit() },
      { slot: "B", fileName: "b.mcap", init: conflicting },
    ]);
    const init = await source.initialize();
    expect(init.datatypes.size).toEqual(1);
    const warn = init.alerts.find((a) => a.severity === "warn");
    expect(warn?.message).toContain("tf2_msgs/TFMessage");
    // 首源优先
    expect(
      init.datatypes.get("tf2_msgs/TFMessage")?.definitions[0]?.name,
    ).toEqual("x");
  });

  it("keeps the first profile and warns when children disagree", async () => {
    const source = makeSource([
      { slot: "A", fileName: "a.mcap", init: fakeInit() },
      { slot: "B", fileName: "b.bag", init: fakeInit({ profile: "ros1" }) },
    ]);
    const init = await source.initialize();
    expect(init.profile).toEqual("ros2");
    expect(init.alerts.some((a) => a.message.includes("profile"))).toEqual(
      true,
    );
  });

  it("names the failing file when a child fails to initialize", async () => {
    const bad: IDeserializedIterableSource = {
      ...makeFakeSource(fakeInit()),
      initialize: async () => {
        throw new Error("corrupt index");
      },
    };
    const source = new CompareIterableSource({
      slots: [
        { source: makeFakeSource(fakeInit()), slot: "A", fileName: "a.mcap" },
        { source: bad, slot: "B", fileName: "broken.mcap" },
      ],
      offsets: new Map(),
    });
    await expect(source.initialize()).rejects.toThrow("broken.mcap");
  });

  it("handles zero-duration children without inverted ranges", async () => {
    const source = makeSource([
      {
        slot: "A",
        fileName: "a.mcap",
        init: fakeInit({ end: { sec: 100, nsec: 0 } }),
      }, // start==end
      { slot: "B", fileName: "b.mcap", init: fakeInit() },
    ]);
    const init = await source.initialize();
    // rostime compare 返回未归一化的差值(secDiff),只断言符号
    expect(compare(init.start, init.end)).toBeLessThan(0); // start < end,不倒置
  });

  it("survives offsets beyond a child's duration without throwing (negative re-anchor)", async () => {
    // A: child [100,200] (duration 100s), offset -300s → slot range [-300, -200]
    // B: child [100,300], offset 0 → slot range [0, 200]
    const source = makeSource(
      [
        { slot: "A", fileName: "a.mcap", init: fakeInit() },
        {
          slot: "B",
          fileName: "b.mcap",
          init: fakeInit({ end: { sec: 300, nsec: 0 } }),
        },
      ],
      new Map([["A", -300_000_000_000n]]),
    );
    const init = await source.initialize();
    expect(init.start).toEqual({ sec: -300, nsec: 0 });
    expect(init.end).toEqual({ sec: 200, nsec: 0 });
  });

  it("normalizes fractional negative offsets to valid Time (negative nsec never escapes)", async () => {
    const source = makeSource(
      [{ slot: "A", fileName: "a.mcap", init: fakeInit() }],
      new Map([["A", -300_500_000_000n]]), // -300.5s
    );
    const init = await source.initialize();
    expect(init.start).toEqual({ sec: -301, nsec: 500_000_000 }); // -300.5s normalized
    expect(init.start.nsec).toBeGreaterThanOrEqual(0);
  });
});

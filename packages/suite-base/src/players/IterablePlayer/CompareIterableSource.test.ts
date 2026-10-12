/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { compare, Time } from "@lichtblick/rostime";
import { SubscribePayload } from "@lichtblick/suite-base/players/types";

import { CompareIterableSource } from "./CompareIterableSource";
import {
  IDeserializedIterableSource,
  Initialization,
  IteratorResult,
} from "./IIterableSource";

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
    publishersByTopic: new Map([["/tf", new Set(["/tf_pub"])]]),
    metadata: [{ name: "session-1", metadata: { creator: "lichtblick" } }],
    alerts: [],
    ...overrides,
  };
}

type FakeMessage = {
  topic: string;
  receiveTime: { sec: number; nsec: number };
};

function makeFakeSource(
  init: Initialization,
  messages: FakeMessage[] = [],
): IDeserializedIterableSource {
  return {
    sourceType: "deserialized",
    initialize: async () => init,
    async *messageIterator(args) {
      for (const msg of messages) {
        if (!args.topics.has(msg.topic)) {
          continue;
        }
        if (
          args.start != undefined &&
          compare(msg.receiveTime, args.start) < 0
        ) {
          continue;
        }
        if (args.end != undefined && compare(msg.receiveTime, args.end) > 0) {
          continue;
        }
        yield {
          type: "message-event",
          msgEvent: {
            topic: msg.topic,
            receiveTime: msg.receiveTime,
            message: { payload: msg.topic },
            sizeInBytes: 4,
            schemaName: "tf2_msgs/TFMessage",
          },
        };
      }
    },
    getBackfillMessages: async (args) => {
      const out = [];
      for (const msg of messages) {
        if (!args.topics.has(msg.topic)) {
          continue;
        }
        if (compare(msg.receiveTime, args.time) <= 0) {
          out.push({
            topic: msg.topic,
            receiveTime: msg.receiveTime,
            message: {},
            sizeInBytes: 4,
            schemaName: "tf2_msgs/TFMessage",
          });
        }
      }
      return out;
    },
  };
}

function makeSource(
  slots: Array<{
    slot: string;
    fileName: string;
    init: Initialization;
    messages?: FakeMessage[];
  }>,
  offsets?: Map<string, bigint>,
) {
  return new CompareIterableSource({
    slots: slots.map((s) => ({
      source: makeFakeSource(s.init, s.messages ?? []),
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
    // publishersByTopic 同样加槽位后缀;metadata 加槽位前缀;schemaName 不受命名空间影响
    expect([...init.publishersByTopic.keys()].sort()).toEqual([
      "/tf@A",
      "/tf@B",
    ]);
    expect(init.metadata?.map((m) => m.name).sort()).toEqual([
      "[A] session-1",
      "[B] session-1",
    ]);
    expect(init.topics.map((t) => t.schemaName)).toEqual([
      "tf2_msgs/TFMessage",
      "tf2_msgs/TFMessage",
    ]);
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

  it("appends child alerts after comparison-generated alerts", async () => {
    const source = makeSource([
      {
        slot: "A",
        fileName: "a.mcap",
        init: fakeInit({
          alerts: [{ severity: "warn", message: "child hiccup" }],
        }),
      },
      { slot: "B", fileName: "b.bag", init: fakeInit({ profile: "ros1" }) },
    ]);
    const init = await source.initialize();
    const messages = init.alerts.map((a) => a.message);
    expect(messages).toContain("child hiccup");
    // 子源 alert 排在对比生成的 alert(profile 冲突)之后
    expect(messages.indexOf("child hiccup")).toBeGreaterThan(
      messages.findIndex((m) => m.includes("profile")),
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

describe("CompareIterableSource.messageIterator / getBackfillMessages", () => {
  function subscribe(topic: string): SubscribePayload {
    return { topic, preloadType: "full" };
  }

  async function collect(
    source: CompareIterableSource,
    topics: string[],
    start?: Time,
  ) {
    const results: IteratorResult[] = [];
    for await (const result of source.messageIterator({
      topics: new Map(topics.map((t) => [t, subscribe(t)])),
      start,
    })) {
      results.push(result);
    }
    return results;
  }

  it("merges by mapped time with per-slot topic suffix and rewritten receiveTime", async () => {
    // A: anchor 100, offset 0  → /tf@A times 0, 2, 4
    // B: anchor 100, offset +1s → /tf@B times 1, 3
    const source = makeSource(
      [
        {
          slot: "A",
          fileName: "a.mcap",
          init: fakeInit(),
          messages: [
            { topic: "/tf", receiveTime: { sec: 100, nsec: 0 } },
            { topic: "/tf", receiveTime: { sec: 102, nsec: 0 } },
            { topic: "/tf", receiveTime: { sec: 104, nsec: 0 } },
          ],
        },
        {
          slot: "B",
          fileName: "b.mcap",
          init: fakeInit(),
          messages: [
            { topic: "/tf", receiveTime: { sec: 100, nsec: 0 } },
            { topic: "/tf", receiveTime: { sec: 102, nsec: 0 } },
          ],
        },
      ],
      new Map([["B", 1_000_000_000n]]),
    );
    await source.initialize();
    const results = await collect(source, ["/tf@A", "/tf@B"]);
    expect(
      results.map((r) =>
        r.type === "message-event"
          ? `${r.msgEvent.topic}@${r.msgEvent.receiveTime.sec}`
          : "?",
      ),
    ).toEqual(["/tf@A@0", "/tf@B@1", "/tf@A@2", "/tf@B@3", "/tf@A@4"]);
  });

  it("breaks mapped-time ties by slot order", async () => {
    const source = makeSource([
      {
        slot: "A",
        fileName: "a.mcap",
        init: fakeInit(),
        messages: [{ topic: "/tf", receiveTime: { sec: 100, nsec: 0 } }],
      },
      {
        slot: "B",
        fileName: "b.mcap",
        init: fakeInit(),
        messages: [{ topic: "/tf", receiveTime: { sec: 100, nsec: 0 } }],
      },
    ]);
    await source.initialize();
    const results = await collect(source, ["/tf@A", "/tf@B"]);
    const first = results[0] as {
      type: "message-event";
      msgEvent: { topic: string };
    };
    expect(first.msgEvent.topic).toEqual("/tf@A");
  });

  it("ignores topics without a slot suffix", async () => {
    const source = makeSource([
      {
        slot: "A",
        fileName: "a.mcap",
        init: fakeInit(),
        messages: [{ topic: "/tf", receiveTime: { sec: 100, nsec: 0 } }],
      },
    ]);
    await source.initialize();
    const results = await collect(source, ["/tf"]); // 无后缀
    expect(results).toEqual([]);
  });

  it("reverse-maps iterator start into child domain per slot (no clamp)", async () => {
    // 流逝域 start=3s → A(偏移0,anchor100) 子域 103;B(偏移+1s,anchor100) 子域 102
    const source = makeSource(
      [
        {
          slot: "A",
          fileName: "a.mcap",
          init: fakeInit(),
          messages: [
            { topic: "/tf", receiveTime: { sec: 100, nsec: 0 } },
            { topic: "/tf", receiveTime: { sec: 105, nsec: 0 } },
          ],
        },
        {
          slot: "B",
          fileName: "b.mcap",
          init: fakeInit(),
          messages: [{ topic: "/tf", receiveTime: { sec: 101, nsec: 0 } }],
        },
      ],
      new Map([["B", 1_000_000_000n]]),
    );
    await source.initialize();
    const results = await collect(source, ["/tf@A", "/tf@B"], {
      sec: 3,
      nsec: 0,
    });
    // A: 子域 ≥103 → 只有 105(映射 5);B: 子域 ≥102 → 无
    expect(results).toHaveLength(1);
    const ev = results[0] as {
      type: "message-event";
      msgEvent: { receiveTime: Time };
    };
    expect(ev.msgEvent.receiveTime).toEqual({ sec: 5, nsec: 0 });
  });

  it("passes through alerts without stalling the merge", async () => {
    const child: IDeserializedIterableSource = {
      ...makeFakeSource(fakeInit(), [
        { topic: "/tf", receiveTime: { sec: 100, nsec: 0 } },
      ]),
      async *messageIterator() {
        yield {
          type: "alert",
          connectionId: 1,
          alert: { severity: "warn", message: "child hiccup" },
        };
        yield {
          type: "message-event",
          msgEvent: {
            topic: "/tf",
            receiveTime: { sec: 100, nsec: 0 },
            message: {},
            sizeInBytes: 0,
            schemaName: "tf2_msgs/TFMessage",
          },
        };
      },
    };
    const source = new CompareIterableSource({
      slots: [{ source: child, slot: "A", fileName: "a.mcap" }],
      offsets: new Map(),
    });
    await source.initialize();
    const results = await collect(source, ["/tf@A"]);
    expect(results[0]?.type).toEqual("alert");
    expect(results[1]?.type).toEqual("message-event");
  });

  it("getBackfillMessages reverse-maps, suffixes, and sorts by mapped time", async () => {
    const source = makeSource(
      [
        {
          slot: "A",
          fileName: "a.mcap",
          init: fakeInit(),
          messages: [{ topic: "/tf", receiveTime: { sec: 100, nsec: 0 } }],
        },
        {
          slot: "B",
          fileName: "b.mcap",
          init: fakeInit(),
          messages: [{ topic: "/tf", receiveTime: { sec: 102, nsec: 0 } }],
        },
      ],
      new Map([["B", -1_000_000_000n]]),
    ); // B 偏移 -1s → 映射时间 1
    await source.initialize();
    const events = await source.getBackfillMessages({
      topics: new Map([
        ["/tf@A", subscribe("/tf@A")],
        ["/tf@B", subscribe("/tf@B")],
      ]),
      time: { sec: 10, nsec: 0 },
    });
    expect(events.map((e) => `${e.topic}@${e.receiveTime.sec}`)).toEqual([
      "/tf@A@0",
      "/tf@B@1",
    ]);
  });
});

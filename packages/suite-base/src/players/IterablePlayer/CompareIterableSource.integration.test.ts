/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// 两个 fake 子源经 CompareIterableSource 垫在真 IterablePlayer 下:
// - 初始 PlayerState 的 start/end/playerId/topics 正确(流逝域 + 后缀)
// - seekPlayback 后经背压管线拿到映射域消息
// harness API 逐字仿 IterablePlayer.test.ts:setSubscriptions([{ topic }])、
// seekPlayback({sec,nsec})、setListener(async (state) => …)、close() + await isClosed。

import { compare } from "@lichtblick/rostime";
import { MessageEvent, PlayerState } from "@lichtblick/suite-base/players/types";

import { CompareIterableSource } from "./CompareIterableSource";
import { IDeserializedIterableSource, Initialization } from "./IIterableSource";
import { IterablePlayer } from "./IterablePlayer";

// fakeInit/makeFakeSource 从 CompareIterableSource.test.ts 复制(勿跨测试文件 import)。
// fakeInit 的 topics 改为 [{ name: "/x", schemaName: "tf2_msgs/TFMessage" }]。
function fakeInit(overrides: Partial<Initialization> = {}): Initialization {
  return {
    start: { sec: 100, nsec: 0 },
    end: { sec: 200, nsec: 0 },
    topics: [{ name: "/x", schemaName: "tf2_msgs/TFMessage" }],
    topicStats: new Map([["/x", { numMessages: 5 }]]),
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
    publishersByTopic: new Map([["/x", new Set(["/x_pub"])]]),
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
        if (args.start != undefined && compare(msg.receiveTime, args.start) < 0) {
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
      const out: MessageEvent[] = [];
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

describe("CompareIterableSource × IterablePlayer integration", () => {
  it("drives a real IterablePlayer over two merged children", async () => {
    const source = new CompareIterableSource({
      slots: [
        {
          source: makeFakeSource(fakeInit(), [{ topic: "/x", receiveTime: { sec: 100, nsec: 0 } }]),
          slot: "A",
          fileName: "a.mcap",
        },
        {
          source: makeFakeSource(fakeInit({ end: { sec: 300, nsec: 0 } }), [
            { topic: "/x", receiveTime: { sec: 250, nsec: 0 } },
          ]),
          slot: "B",
          fileName: "b.mcap",
        },
      ],
      offsets: new Map(),
    });
    const player = new IterablePlayer({
      source,
      name: "Comparison: a.mcap, b.mcap",
      sourceId: "compare-files",
      playerId: "it-player",
      enablePreload: false,
      readAheadDuration: { sec: 1, nsec: 0 },
    });
    const states: PlayerState[] = [];
    const ready = new Promise<PlayerState>((resolve) => {
      player.setListener(async (state) => {
        states.push(state);
        if (state.activeData?.startTime != undefined) {
          resolve(state);
        }
      });
    });
    const settled = await ready;
    expect(settled.activeData?.startTime).toEqual({ sec: 0, nsec: 0 });
    expect(settled.activeData?.endTime).toEqual({ sec: 200, nsec: 0 }); // max(100, 200) 流逝
    expect(settled.playerId).toEqual("it-player");
    expect(settled.name).toEqual("Comparison: a.mcap, b.mcap");
    expect((settled.activeData?.topics ?? []).map((t) => t.name).sort()).toEqual(["/x@A", "/x@B"]);
    player.close();
    await player.isClosed;
  });

  it("seek backfills only slots whose messages precede the seek point", async () => {
    // A: anchor 100, 消息 100/105(流逝 0/5);B: anchor 100, 消息 250(流逝 150)
    const source = new CompareIterableSource({
      slots: [
        {
          slot: "A",
          fileName: "a.mcap",
          source: makeFakeSource(fakeInit(), [
            { topic: "/x", receiveTime: { sec: 100, nsec: 0 } },
            { topic: "/x", receiveTime: { sec: 105, nsec: 0 } },
          ]),
        },
        {
          slot: "B",
          fileName: "b.mcap",
          source: makeFakeSource(fakeInit(), [{ topic: "/x", receiveTime: { sec: 250, nsec: 0 } }]),
        },
      ],
      offsets: new Map(),
    });
    const player = new IterablePlayer({
      source,
      name: "Comparison: a.mcap, b.mcap",
      sourceId: "compare-files",
      playerId: "it-player",
      enablePreload: false,
      readAheadDuration: { sec: 1, nsec: 0 },
    });

    // 单 listener 双 promise:一个等初始化,一个等首个带消息的 state。
    // 初始化后的 START_DELAY_MS(100ms)窗口内 #state 仍是 "initialize",
    // 此刻 seekPlayback 会存为 seekTarget,由 start-play 直接转入 seek-backfill,
    // 因此首个带消息的 state 必然来自 seek 而非初始读。
    let initialized!: () => void;
    let messagesSeen!: (messages: readonly MessageEvent[]) => void;
    const initializedPromise = new Promise<void>((resolve) => {
      initialized = resolve;
    });
    const messagesPromise = new Promise<readonly MessageEvent[]>((resolve) => {
      messagesSeen = resolve;
    });
    player.setSubscriptions([{ topic: "/x@A" }, { topic: "/x@B" }]);
    player.setListener(async (state) => {
      if (state.activeData?.startTime != undefined) {
        initialized();
      }
      if ((state.activeData?.messages.length ?? 0) > 0) {
        messagesSeen(state.activeData!.messages);
      }
    });
    await initializedPromise;

    // seek 到流逝 10:backfill 反算 A→子域 110(命中 100/105 两条)、B→子域 110(250 不可达)
    player.seekPlayback({ sec: 10, nsec: 0 });
    const messages = await messagesPromise;
    expect(messages.map((m) => `${m.topic}@${m.receiveTime.sec}`).sort()).toEqual([
      "/x@A@0",
      "/x@A@5",
    ]);
    expect(messages.every((m) => m.topic !== "/x@B")).toEqual(true);
    player.close();
    await player.isClosed;
  });
});

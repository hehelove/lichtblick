// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

import { compare as compareTime, Time, toNanoSec } from "@lichtblick/rostime";
import { MessageEvent, Metadata } from "@lichtblick/suite";
import { PlayerAlert, TopicSelection, TopicStats } from "@lichtblick/suite-base/players/types";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

import {
  GetBackfillMessagesArgs,
  IDeserializedIterableSource,
  Initialization,
  IteratorResult,
  MessageIteratorArgs,
  TopicWithDecodingInfo,
} from "./IIterableSource";

export type CompareSlotInput = {
  source: IDeserializedIterableSource;
  slot: string;
  fileName: string;
};

export type CompareIterableSourceOptions = {
  slots: CompareSlotInput[];
  /** Per-slot user offset in nanoseconds; a missing entry means 0. */
  offsets: Map<string, bigint>;
};

const SLOT_SUFFIX_RE = /^(.*)@([A-Z])$/;

/** Splits a compare-namespaced topic (`/tf@A`) into its base name and slot letter. */
export function slotOfTopic(topic: string): { baseName: string; slot: string } | undefined {
  const match = SLOT_SUFFIX_RE.exec(topic);
  if (match == undefined) {
    return undefined;
  }
  return { baseName: match[1]!, slot: match[2]! };
}

const NS_PER_SEC = 1_000_000_000n;

/** Converts signed nanoseconds to a normalized Time (nsec always in [0, 1e9), sign carried by sec). */
function nsToTime(ns: bigint): Time {
  const sec = ns / NS_PER_SEC;
  const rem = ns % NS_PER_SEC;
  if (ns < 0n && rem !== 0n) {
    return { sec: Number(sec - 1n), nsec: Number(NS_PER_SEC + rem) };
  }
  return { sec: Number(sec), nsec: Number(rem) };
}

/** Maps a child-domain time into the shared elapsed timeline. */
function toElapsed(slot: InitializedSlot, time: Time): Time {
  return nsToTime(toNanoSec(time) - slot.anchorNs + slot.offsetNs);
}

/** Maps an elapsed-domain time back into a child's recording domain. */
function toChildDomain(slot: InitializedSlot, time: Time): Time {
  return nsToTime(toNanoSec(time) - slot.offsetNs + slot.anchorNs);
}

type InitializedSlot = {
  input: CompareSlotInput;
  init: Initialization;
  anchorNs: bigint; // 子源录制起点(ns)
  offsetNs: bigint; // 用户偏移(ns)
};

/**
 * Composes N file-backed sources into one shared elapsed timeline. Each child is anchored at its
 * own recording start (t=0) and shifted by its per-slot offset; topics are suffixed `@<slot>`.
 * The K-way merge in messageIterator emits strictly by mapped time, satisfying the receiveTime
 * monotonicity MessageOrderTracker expects.
 */
export class CompareIterableSource implements IDeserializedIterableSource {
  public readonly sourceType = "deserialized";
  readonly #options: CompareIterableSourceOptions;
  #initialized: InitializedSlot[] = [];

  public constructor(options: CompareIterableSourceOptions) {
    this.#options = options;
  }

  public async initialize(): Promise<Initialization> {
    // spec §5 写 "Semaphore 并发初始化(复用 MultiIterableSource 模式)"——Semaphore 的用途是
    // 限并发(多文件 merge 可达几十个);本源槽位上限 3,Promise.all 即全并发且等价,不引入 Semaphore。
    const results = await Promise.all(
      this.#options.slots.map(async (input) => {
        try {
          return { input, init: await input.source.initialize() };
        } catch (err: unknown) {
          throw new Error(
            `Comparison failed to open ${input.fileName} (slot ${input.slot}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }),
    );

    const initialized: InitializedSlot[] = results.map(({ input, init }) => ({
      input,
      init,
      anchorNs: toNanoSec(init.start),
      offsetNs: this.#options.offsets.get(input.slot) ?? 0n,
    }));
    this.#initialized = initialized;

    const topics: TopicWithDecodingInfo[] = [];
    const topicStats = new Map<string, TopicStats>();
    const publishersByTopic = new Map<string, Set<string>>();
    const datatypes: RosDatatypes = new Map();
    const alerts: PlayerAlert[] = [];
    const metadata: Metadata[] = [];
    let profile: string | undefined;

    for (const { input, init } of initialized) {
      for (const topic of init.topics) {
        topics.push({ ...topic, name: `${topic.name}@${input.slot}` });
      }
      for (const [name, stats] of init.topicStats) {
        topicStats.set(`${name}@${input.slot}`, stats);
      }
      for (const [name, publishers] of init.publishersByTopic) {
        publishersByTopic.set(`${name}@${input.slot}`, publishers);
      }
      for (const meta of init.metadata ?? []) {
        metadata.push({ ...meta, name: `[${input.slot}] ${meta.name}` });
      }
      for (const [name, datatype] of init.datatypes) {
        const existing = datatypes.get(name);
        if (existing != undefined) {
          if (!_.isEqual(existing, datatype)) {
            alerts.push({
              severity: "warn",
              message: `Comparison: conflicting definitions for datatype ${name}; using the one from the first slot`,
            });
          }
          continue;
        }
        datatypes.set(name, datatype);
      }
      if (profile == undefined) {
        profile = init.profile;
      } else if (init.profile != undefined && init.profile !== profile) {
        alerts.push({
          severity: "warn",
          message: `Comparison: sources use different profiles (${profile} vs ${init.profile}); keeping ${profile}`,
        });
      }
    }

    // spec §5: 子源自身的 alert 原样并入,排在对比生成的 alert 之后(槽位序拼接)
    for (const { init } of initialized) {
      alerts.push(...init.alerts);
    }

    let start: Time | undefined;
    let end: Time | undefined;
    for (const slot of initialized) {
      const slotStart = nsToTime(slot.offsetNs);
      const slotEnd = nsToTime(toNanoSec(slot.init.end) - slot.anchorNs + slot.offsetNs);
      if (start == undefined || compareTime(slotStart, start) < 0) {
        start = slotStart;
      }
      if (end == undefined || compareTime(slotEnd, end) > 0) {
        end = slotEnd;
      }
    }

    return {
      start: start!,
      end: end!,
      topics,
      topicStats,
      datatypes,
      profile,
      name: `Comparison: ${initialized.map(({ input }) => input.fileName).join(", ")}`,
      metadata,
      publishersByTopic,
      alerts,
    };
  }

  /** Partitions suffixed topics into per-slot selections keyed by base name. */
  #partitionTopics(topics: TopicSelection): Map<string, TopicSelection> {
    const perSlotTopics = new Map<string, TopicSelection>();
    for (const topic of topics.keys()) {
      const parsed = slotOfTopic(topic);
      if (parsed == undefined) {
        continue; // 无槽位后缀的 topic 不属于任何子源,静默忽略
      }
      let selection = perSlotTopics.get(parsed.slot);
      if (selection == undefined) {
        selection = new Map();
        perSlotTopics.set(parsed.slot, selection);
      }
      selection.set(parsed.baseName, topics.get(topic)!);
    }
    return perSlotTopics;
  }

  public async *messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {
    const perSlotTopics = this.#partitionTopics(args.topics);

    type Head = {
      slot: InitializedSlot;
      iter: AsyncIterableIterator<Readonly<IteratorResult>>;
      current?: Readonly<IteratorResult>;
      mappedTime?: Time;
    };
    const pendingAlerts: IteratorResult[] = [];
    const heads: Head[] = [];
    try {
      for (const slot of this.#initialized) {
        const topics = perSlotTopics.get(slot.input.slot);
        if (topics == undefined || topics.size === 0) {
          continue;
        }
        const childArgs: MessageIteratorArgs = {
          topics,
          consumptionType: args.consumptionType,
        };
        // 反算不 clamp:早于子源起点则子源自然从头迭代,晚于终点则自然空转
        if (args.start != undefined) {
          childArgs.start = toChildDomain(slot, args.start);
        }
        if (args.end != undefined) {
          childArgs.end = toChildDomain(slot, args.end);
        }
        heads.push({
          slot,
          iter: slot.input.source.messageIterator(childArgs),
        });
      }

      const pull = async (head: Head): Promise<void> => {
        for (;;) {
          const res = await head.iter.next();
          if (res.done ?? false) {
            head.current = undefined;
            head.mappedTime = undefined;
            return;
          }
          if (res.value.type === "alert") {
            pendingAlerts.push(res.value); // 无时间戳,缓存后立即冲刷
            continue;
          }
          head.current = res.value;
          head.mappedTime =
            res.value.type === "message-event"
              ? toElapsed(head.slot, res.value.msgEvent.receiveTime)
              : toElapsed(head.slot, res.value.stamp);
          return;
        }
      };

      await Promise.all(
        heads.map(async (head) => {
          await pull(head);
        }),
      );

      for (;;) {
        const alert = pendingAlerts.shift();
        if (alert != undefined) {
          yield alert;
          continue;
        }
        let min: Head | undefined;
        for (const head of heads) {
          if (head.current == undefined || head.mappedTime == undefined) {
            continue;
          }
          if (min == undefined || compareTime(head.mappedTime, min.mappedTime!) < 0) {
            min = head; // 严格小于:平局时保住先入者(槽位字母序)
          }
        }
        if (min == undefined) {
          return;
        }
        const current = min.current!;
        if (current.type === "message-event") {
          yield {
            type: "message-event",
            msgEvent: {
              ...current.msgEvent,
              topic: `${current.msgEvent.topic}@${min.slot.input.slot}`,
              receiveTime: toElapsed(min.slot, current.msgEvent.receiveTime),
            },
          };
        } else if (current.type === "stamp") {
          yield { type: "stamp", stamp: toElapsed(min.slot, current.stamp) };
        }
        await pull(min);
      }
    } finally {
      // Consumer `.return()`(IterablePlayer 每次 seek/stop 都会调用)或中途抛错都会走到这里;
      // 不显式关闭子迭代器,它们会永久挂起在 yield 处,子源 finally(如 pool pin 释放)永不执行。
      await Promise.allSettled(
        heads.map(async (head) => {
          await head.iter.return?.();
        }),
      );
    }
  }

  public async getBackfillMessages(args: GetBackfillMessagesArgs): Promise<MessageEvent[]> {
    const perSlotTopics = this.#partitionTopics(args.topics);

    // 记录 slotIndex,平局时按槽位序排序:Promise.all 的完成顺序不确定,
    // 仅靠稳定排序无法保证映射时间相同的消息顺序确定。
    const out: { event: MessageEvent; slotIndex: number }[] = [];
    await Promise.all(
      this.#initialized.map(async (slot, slotIndex) => {
        const topics = perSlotTopics.get(slot.input.slot);
        if (topics == undefined || topics.size === 0) {
          return;
        }
        const events = await slot.input.source.getBackfillMessages({
          topics,
          time: toChildDomain(slot, args.time),
          abortSignal: args.abortSignal,
        });
        for (const event of events) {
          out.push({
            event: {
              ...event,
              topic: `${event.topic}@${slot.input.slot}`,
              receiveTime: toElapsed(slot, event.receiveTime),
            },
            slotIndex,
          });
        }
      }),
    );
    out.sort((a, b) => {
      const byTime = compareTime(a.event.receiveTime, b.event.receiveTime);
      return byTime !== 0 ? byTime : a.slotIndex - b.slotIndex;
    });
    return out.map((entry) => entry.event);
  }
}

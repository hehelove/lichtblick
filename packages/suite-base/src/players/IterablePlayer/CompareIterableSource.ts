// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

import {
  add as addTime,
  compare as compareTime,
  fromNanoSec,
  subtract as subtractTime,
  Time,
} from "@lichtblick/rostime";
import { MessageEvent, Metadata } from "@lichtblick/suite";
import { PlayerAlert, TopicStats } from "@lichtblick/suite-base/players/types";
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
export function slotOfTopic(
  topic: string,
): { baseName: string; slot: string } | undefined {
  const match = SLOT_SUFFIX_RE.exec(topic);
  if (match == undefined) {
    return undefined;
  }
  return { baseName: match[1]!, slot: match[2]! };
}

// Task 4 的 messageIterator 需要每个槽位的 anchor/offsetTime;届时再提升为实例字段
// (现在提升会因只写不读触发 TS6133)。
type InitializedSlot = {
  input: CompareSlotInput;
  init: Initialization;
  anchor: Time; // 子源录制起点
  offsetTime: Time; // 用户偏移
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
      anchor: init.start,
      offsetTime: fromNanoSec(this.#options.offsets.get(input.slot) ?? 0n),
    }));

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

    let start: Time | undefined;
    let end: Time | undefined;
    for (const slot of initialized) {
      const slotStart = slot.offsetTime;
      const slotEnd = addTime(
        subtractTime(slot.init.end, slot.anchor),
        slot.offsetTime,
      );
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

  // eslint-disable-next-line require-yield -- 占位 stub,Task 4 填实现(BlockLoader.test.ts 同款豁免)
  public async *messageIterator(
    _args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {
    // Task 4 实现
    throw new Error("not implemented");
  }

  public async getBackfillMessages(
    _args: GetBackfillMessagesArgs,
  ): Promise<MessageEvent[]> {
    // Task 4 实现
    return [];
  }
}

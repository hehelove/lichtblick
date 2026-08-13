// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { toNanoSec, Time } from "@lichtblick/rostime";
import { MessageEvent } from "@lichtblick/suite";

const MAX_TIMESTAMPS = 250;

type TimestampedMessage = {
  header?: { stamp?: Time };
  markers?: { header?: { stamp?: Time } }[];
  timestamp?: Time;
};

type SceneUpdateMessage = {
  entities?: { timestamp?: Time }[];
  deletions?: { timestamp?: Time }[];
};

export class SyncManager {
  #topics = new Set<string>();
  #messagesByTimestamp = new Map<bigint, Map<string, MessageEvent>>();

  public setTopics(topics: ReadonlySet<string>): void {
    if (setsEqual(this.#topics, topics)) {
      return;
    }
    this.#topics = new Set(topics);
    this.clear();
  }

  public clear(): void {
    this.#messagesByTimestamp.clear();
  }

  public addMessageEvent(messageEvent: MessageEvent): MessageEvent[] {
    if (!this.#topics.has(messageEvent.topic)) {
      return [messageEvent];
    }

    const timestamp = getMessageTimestamp(messageEvent);
    if (timestamp == undefined) {
      if (isEmptySceneUpdate(messageEvent)) {
        return [messageEvent];
      }
      return [];
    }

    let messages = this.#messagesByTimestamp.get(timestamp);
    if (!messages) {
      messages = new Map();
      this.#messagesByTimestamp.set(timestamp, messages);
      if (this.#messagesByTimestamp.size > MAX_TIMESTAMPS) {
        const oldestTimestamp = this.#messagesByTimestamp.keys().next().value;
        if (oldestTimestamp != undefined) {
          this.#messagesByTimestamp.delete(oldestTimestamp);
        }
      }
    }
    messages.set(messageEvent.topic, messageEvent);

    if (messages.size !== this.#topics.size) {
      return [];
    }
    this.#messagesByTimestamp.delete(timestamp);
    return Array.from(this.#topics, (topic) => messages.get(topic)!);
  }

  public addMessageEventBatch(messageEvents: readonly MessageEvent[]): MessageEvent[] {
    return messageEvents.flatMap((messageEvent) => this.addMessageEvent(messageEvent));
  }
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && Array.from(left).every((topic) => right.has(topic));
}

function getMessageTimestamp(messageEvent: MessageEvent): bigint | undefined {
  const { message } = messageEvent;
  if (message == undefined || typeof message !== "object") {
    return undefined;
  }
  const timestamped = message as TimestampedMessage;
  const timestamp =
    messageEvent.schemaName === "foxglove.SceneUpdate"
      ? getSceneUpdateTimestamp(message)
      : (timestamped.timestamp ??
        timestamped.header?.stamp ??
        timestamped.markers?.[0]?.header?.stamp);
  if (
    timestamp == undefined ||
    typeof timestamp.sec !== "number" ||
    typeof timestamp.nsec !== "number"
  ) {
    return undefined;
  }
  return toNanoSec(timestamp);
}

function getSceneUpdateTimestamp(message: SceneUpdateMessage): Time | undefined {
  return message.entities?.[0]?.timestamp ?? message.deletions?.[0]?.timestamp;
}

function isEmptySceneUpdate(messageEvent: MessageEvent): boolean {
  if (messageEvent.schemaName !== "foxglove.SceneUpdate") {
    return false;
  }
  const message = messageEvent.message as SceneUpdateMessage;
  return message.entities?.length === 0 && message.deletions?.length === 0;
}

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { Opaque } from "ts-essentials";

import { Immutable, MessageEvent, MessageConverterContext, Subscription } from "@lichtblick/suite";
import { GlobalVariables } from "@lichtblick/suite-base/hooks/useGlobalVariables";
import { Topic as PlayerTopic } from "@lichtblick/suite-base/players/types";
import { InstalledMessageConverter } from "@lichtblick/suite-base/types/messageConverters";
import { formatTimeRaw } from "@lichtblick/suite-base/util/time";

import type { MessageConverterAlertHandler } from "./types";

// Branded string to ensure that users go through the `converterKey` function to compute a lookup key
export type ConverterKey = Opaque<string, "ConverterKey">;

type TopicSchemaConverterMap = Map<ConverterKey, InstalledMessageConverter[]>;

type ConvertMessageContext = {
  emitAlert?: MessageConverterAlertHandler;
};

// Create a string lookup key from a message event
//
// The string key uses a newline delimeter to avoid producting the same key for topic/schema name
// values that might concatenate to the same string. i.e. "topic" "schema" and "topics" "chema".
function converterKey(topic: string, schema: string): ConverterKey {
  return (topic + "\n" + schema) as ConverterKey;
}

/**
 * Convert message into convertedMessages using the keyed converters. Modifies
 * convertedMessages in place for efficiency.
 */
export function convertMessage(
  messageEvent: Immutable<MessageEvent>,
  converters: Immutable<TopicSchemaConverterMap>,
  convertedMessages: MessageEvent[],
  globalVariables?: Readonly<GlobalVariables>,
  context?: ConvertMessageContext,
): void {
  const key = converterKey(messageEvent.topic, messageEvent.schemaName);
  const matchedConverters = converters.get(key);
  for (const converter of matchedConverters ?? []) {
    const emitAlert: MessageConverterContext["emitAlert"] = (alert, alertId) => {
      context?.emitAlert?.(converter, alert, alertId);
    };
    const converterContext: MessageConverterContext = {
      emitAlert,
    };
    try {
      const convertedMessage = converter.converter(
        messageEvent.message,
        messageEvent,
        globalVariables,
        converterContext,
      );
      // If the converter returns _undefined_ or _null_ the message is skipped
      if (convertedMessage == undefined) {
        continue;
      }
      convertedMessages.push({
        topic: messageEvent.topic,
        schemaName: converter.toSchemaName,
        receiveTime: messageEvent.receiveTime,
        message: convertedMessage,
        originalMessageEvent: messageEvent,
        sizeInBytes: messageEvent.sizeInBytes,
        topicConfig: messageEvent.topicConfig,
      });
    } catch (e) {
      const error =
        e instanceof Error ? e : new Error(typeof e === "string" ? e : JSON.stringify(e));
      emitAlert(
        {
          severity: "error",
          message: `Uncaught error in message converter (${converter.extensionId}) at ${formatTimeRaw(messageEvent.receiveTime)}`,
          error,
        },
        `messageConverterError-${converter.extensionId}`,
      );
    }
  }
}

/**
 * Run any topic converters whose inputTopics include this message's topic, pushing the produced
 * virtual-topic messages into `convertedMessages`. The `converterFns` map caches the per-converter
 * function returned by `create(globalVariables)`; callers must clear it when the watched global
 * variables (or the converter set) change so instances are rebuilt with fresh variables.
 */
export function runTopicConverters(
  messageEvent: Immutable<MessageEvent>,
  byInput: Map<string, Immutable<TopicConverter>[]>,
  converterFns: Map<Immutable<TopicConverter>, (event: Immutable<MessageEvent>) => unknown>,
  convertedMessages: MessageEvent[],
  globalVariables?: Readonly<GlobalVariables>,
  context?: ConvertMessageContext,
  // outputTopic allow-list for THIS panel's subscriptions. A single inputTopic frequently fans out
  // to many converters/outputTopics (e.g. one SyncLidarCameraData -> 7 per-camera topics). Without
  // this filter every panel's currentFrame would be flooded with ALL virtual topics, so a panel
  // subscribed to only one camera ends up showing whichever one the consumer picks (all panels look
  // identical). When provided, only run converters whose outputTopic this panel subscribed to.
  subscribedOutputTopics?: ReadonlySet<string>,
): void {
  const matched = byInput.get(messageEvent.topic);
  if (!matched) {
    return;
  }
  for (const converter of matched) {
    if (subscribedOutputTopics && !subscribedOutputTopics.has(converter.outputTopic)) {
      continue;
    }
    let fn = converterFns.get(converter);
    if (!fn) {
      try {
        fn = converter.create(globalVariables);
      } catch (e) {
        emitConverterError(converter, messageEvent, e, context);
        continue;
      }
      converterFns.set(converter, fn);
    }

    let result: unknown;
    try {
      result = fn(messageEvent);
    } catch (e) {
      emitConverterError(converter, messageEvent, e, context);
      continue;
    }

    // A converter may return undefined/null (skip), a single message, or an array of messages.
    if (result == undefined) {
      continue;
    }
    const produced = Array.isArray(result) ? result : [result];
    for (const message of produced) {
      if (message == undefined) {
        continue;
      }
      convertedMessages.push({
        topic: converter.outputTopic,
        schemaName: converter.outputSchemaName,
        receiveTime: messageEvent.receiveTime,
        message,
        originalMessageEvent: messageEvent,
        sizeInBytes: messageEvent.sizeInBytes,
        topicConfig: messageEvent.topicConfig,
      });
    }
  }
}

function emitConverterError(
  converter: Immutable<TopicConverter>,
  messageEvent: Immutable<MessageEvent>,
  e: unknown,
  context?: ConvertMessageContext,
): void {
  const error = e instanceof Error ? e : new Error(typeof e === "string" ? e : JSON.stringify(e));
  context?.emitAlert?.(
    converter as Immutable<InstalledMessageConverter>,
    {
      severity: "error",
      message: `Uncaught error in topic converter (${converter.extensionId}) at ${formatTimeRaw(messageEvent.receiveTime)}`,
      error,
    },
    `topicConverterError-${converter.extensionId}-${converter.outputTopic}`,
  );
}

/**
 * Returns a new map consisting of all items in `a` not present in `b`.
 */
export function mapDifference<K, V>(a: Map<K, V[]>, b: undefined | Map<K, V[]>): Map<K, V[]> {
  const result = new Map<K, V[]>();
  for (const [key, value] of a.entries()) {
    const newValues = _.difference(value, b?.get(key) ?? []);
    if (newValues.length > 0) {
      result.set(key, newValues);
    }
  }
  return result;
}

/**
 * A "topic converter" (Foxglove-style) reads one or more `inputTopics` and produces a brand new
 * virtual `outputTopic`. Lichtblick's upstream runtime only implements schema converters
 * (fromSchemaName -> toSchemaName on the same topic); this is the fork runtime support.
 */
export type TopicConverter = InstalledMessageConverter & {
  type: "topic";
  inputTopics: readonly string[];
  outputTopic: string;
  outputSchemaName: string;
  create: (
    globalVariables?: Readonly<GlobalVariables>,
  ) => (event: Immutable<MessageEvent>) => unknown;
};

/** Type guard: a fully-formed topic converter (inputTopics -> outputTopic). */
export function isTopicConverter(
  converter: Immutable<InstalledMessageConverter>,
): converter is Immutable<TopicConverter> {
  const c = converter as Immutable<Partial<TopicConverter>>;
  return (
    c.type === "topic" &&
    Array.isArray(c.inputTopics) &&
    c.inputTopics.length > 0 &&
    typeof c.outputTopic === "string" &&
    typeof c.outputSchemaName === "string" &&
    typeof c.create === "function"
  );
}

export type TopicConverterCollation = {
  // outputTopic -> the converter that produces it (first wins on collision).
  byOutput: Map<string, Immutable<TopicConverter>>;
  // inputTopic -> converters that consume it.
  byInput: Map<string, Immutable<TopicConverter>[]>;
};

/**
 * Collate topic converters into lookup maps keyed by their output and input topics.
 * Memoize over `messageConverters` for stable identity (drives renderState rebuilds).
 */
export function collateTopicConverters(
  messageConverters: undefined | readonly Immutable<InstalledMessageConverter>[],
): TopicConverterCollation {
  const byOutput = new Map<string, Immutable<TopicConverter>>();
  const byInput = new Map<string, Immutable<TopicConverter>[]>();
  for (const converter of messageConverters ?? []) {
    if (!isTopicConverter(converter)) {
      continue;
    }
    if (!byOutput.has(converter.outputTopic)) {
      byOutput.set(converter.outputTopic, converter);
    }
    for (const inputTopic of converter.inputTopics) {
      let list = byInput.get(inputTopic);
      if (!list) {
        list = [];
        byInput.set(inputTopic, list);
      }
      list.push(converter);
    }
  }
  return { byOutput, byInput };
}

export type TopicSchemaConversions = {
  // Topics which we are subscribed without a conversion, these are topics we
  // want to receive the original message.
  unconvertedSubscriptionTopics: Set<string>;

  // When a subscription with a convertTo exists, we use this map to lookup a
  // converter which can produce the desired output message schema. The keys for
  // the map are `topic + input schema`.
  //
  // This allows the runtime message event handler logic which builds
  // currentFrame and allFrames to lookup whether the incoming message event has
  // converters to run by looking up the topic + schema of the message event in
  // this map.
  topicSchemaConverters: TopicSchemaConverterMap;
};

/**
 * Builds a set of topics we can render without conversion and a map of
 * converterKey -> converter arguments we use to produce converted messages.
 *
 * This will be memoized for performance so the inputs should be stable.
 */
export function collateTopicSchemaConversions(
  subscriptions: readonly Subscription[],
  sortedTopics: readonly PlayerTopic[],
  messageConverters: undefined | readonly InstalledMessageConverter[],
): TopicSchemaConversions {
  const topicSchemaConverters: TopicSchemaConverterMap = new Map();
  const unconvertedSubscriptionTopics = new Set<string>();

  // Output topics of topic converters are virtual: they have no original message and are driven by
  // the byInput path in renderState. Exclude them here so a plain (no convertTo) subscription to an
  // outputTopic is not mistaken for a request to pass through a (non-existent) raw message.
  const topicConverterOutputs = new Set<string>();
  for (const converter of messageConverters ?? []) {
    if (isTopicConverter(converter)) {
      topicConverterOutputs.add(converter.outputTopic);
    }
  }

  // Bin the subscriptions into two sets: those which want a conversion and those that do not.
  //
  // For the subscriptions that want a conversion, if the topic schemaName matches the requested
  // convertTo, then we don't need to do a conversion.
  for (const subscription of subscriptions) {
    if (!subscription.convertTo) {
      if (!topicConverterOutputs.has(subscription.topic)) {
        unconvertedSubscriptionTopics.add(subscription.topic);
      }
      continue;
    }

    // If the convertTo is the same as the original schema for the topic then we don't need to
    // perform a conversion.
    const noConversion = sortedTopics.find(
      (topic) => topic.name === subscription.topic && topic.schemaName === subscription.convertTo,
    );
    if (noConversion) {
      unconvertedSubscriptionTopics.add(noConversion.name);
      continue;
    }

    // Since we don't have an existing topic with out destination schema we need to find
    // a converter that will convert from the topic to the desired schema
    const subscriberTopic = sortedTopics.find((topic) => topic.name === subscription.topic);
    if (!subscriberTopic) {
      continue;
    }

    const key = converterKey(subscription.topic, subscriberTopic.schemaName ?? "<no-schema>");
    let existingConverters = topicSchemaConverters.get(key);

    // We've already stored a converter for this topic to convertTo
    const haveConverter = existingConverters?.find(
      (conv) => conv.toSchemaName === subscription.convertTo,
    );
    if (haveConverter) {
      continue;
    }

    // Find a converter that can go from the original topic schema to the target schema
    const converters = (messageConverters ?? []).filter(
      (conv) =>
        conv.fromSchemaName === subscriberTopic.schemaName &&
        conv.toSchemaName === subscription.convertTo,
    );
    // Prefer 'local' converters over 'org' provided ones
    const converter = _.minBy(converters, (conv) => conv.extensionNamespace ?? "unknown");

    if (converter) {
      existingConverters ??= [];
      existingConverters.push(converter);
      topicSchemaConverters.set(key, existingConverters);
    }
  }

  return { unconvertedSubscriptionTopics, topicSchemaConverters };
}

/**
 * Function to iterate and call function over multiple sorted arrays in sorted order across all items in all arrays.
 * Time complexity is O(t*n) where t is the number of arrays and n is the total number of items in all arrays.
 * Space complexity is O(t) where t is the number of arrays.
 * @param arrays - sorted arrays to iterate over
 * @param compareFn - function called to compare items in arrays. Returns a positive value if left is larger than right,
 *  a negative value if right is larger than left, or zero if both are equal
 * @param forEach - callback to be executed on all items in the arrays to iterate over in sorted order across all arrays
 */
export function forEachSortedArrays<Item>(
  arrays: Immutable<Item[][]>,
  compareFn: (a: Immutable<Item>, b: Immutable<Item>) => number,
  forEach: (item: Immutable<Item>) => void,
): void {
  const cursors: number[] = Array(arrays.length).fill(0);
  if (arrays.length === 0) {
    return;
  }
  for (;;) {
    let minCursorIndex: number | undefined = undefined;
    for (let i = 0; i < cursors.length; i++) {
      const cursor = cursors[i]!;
      const array = arrays[i]!;
      if (cursor >= array.length) {
        continue;
      }
      const item = array[cursor]!;
      if (minCursorIndex == undefined) {
        minCursorIndex = i;
      } else {
        const minItem = arrays[minCursorIndex]![cursors[minCursorIndex]!]!;
        if (compareFn(item, minItem) < 0) {
          minCursorIndex = i;
        }
      }
    }
    if (minCursorIndex == undefined) {
      break;
    }
    const minItem = arrays[minCursorIndex]![cursors[minCursorIndex]!];
    if (minItem != undefined) {
      forEach(minItem);
      cursors[minCursorIndex]!++;
    } else {
      break;
    }
  }
}

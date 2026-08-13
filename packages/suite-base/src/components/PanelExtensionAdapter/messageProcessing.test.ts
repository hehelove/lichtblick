// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessageEvent } from "@lichtblick/suite";
import GlobalVariableBuilder from "@lichtblick/suite-base/testing/builders/GlobalVariableBuilder";
import MessageEventBuilder from "@lichtblick/suite-base/testing/builders/MessageEventBuilder";
import { InstalledMessageConverter } from "@lichtblick/suite-base/types/messageConverters";

import {
  collateTopicConverters,
  collateTopicSchemaConversions,
  convertMessage,
  forEachSortedArrays,
  isTopicConverter,
  runTopicConverters,
  TopicConverter,
} from "./messageProcessing";

function makeTopicConverter(overrides: Partial<TopicConverter> = {}): InstalledMessageConverter {
  return {
    type: "topic",
    inputTopics: ["/in"],
    outputTopic: "/out",
    outputSchemaName: "foxglove.SceneUpdate",
    create:
      () =>
      (event: { message: unknown }): unknown => ({ derived: event.message }),
    extensionId: "ext.test",
    ...overrides,
  } as unknown as InstalledMessageConverter;
}

describe("forEachSortedArrays", () => {
  it("should not call forEach for empty arrays", () => {
    const forEach = jest.fn();
    const arr: number[] = [];
    forEachSortedArrays([arr, arr], (a, b) => a - b, forEach);
    expect(forEach).not.toHaveBeenCalled();
  });
  it("merges arrays with exclusive ranges", () => {
    const acc: number[] = [];
    const forEach = (item: number) => acc.push(item);
    const arr1 = [1, 2, 3];
    const arr2 = [4, 5, 6];

    forEachSortedArrays([arr1, arr2], (a, b) => a - b, forEach);
    expect(acc).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("merges two interleaved arrays", () => {
    const acc: number[] = [];
    const forEach = (item: number) => acc.push(item);
    const arr1 = [1, 3, 5];
    const arr2 = [2, 4, 6];

    forEachSortedArrays([arr1, arr2], (a, b) => a - b, forEach);
    expect(acc).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("merges three interleaved arrays", () => {
    const acc: number[] = [];
    const forEach = (item: number) => acc.push(item);
    const arr1 = [1, 4, 7];
    const arr2 = [2, 5, 8];
    const arr3 = [3, 6, 9];

    forEachSortedArrays([arr1, arr2, arr3], (a, b) => a - b, forEach);
    expect(acc).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it("merges three exclusive arrays", () => {
    const acc: number[] = [];
    const forEach = (item: number) => acc.push(item);
    const arr1 = [4, 5, 6];
    const arr2 = [1, 2, 3];
    const arr3 = [7, 8, 9];

    forEachSortedArrays([arr1, arr2, arr3], (a, b) => a - b, forEach);
    expect(acc).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it("merges three identical arrays", () => {
    const acc: number[] = [];
    const forEach = (item: number) => acc.push(item);
    const arr1 = [1, 2, 3];
    const arr2 = [1, 2, 3];
    const arr3 = [1, 2, 3];

    forEachSortedArrays([arr1, arr2, arr3], (a, b) => a - b, forEach);
    expect(acc).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
  });
  it("merges two identical arrays and one empty array", () => {
    const acc: number[] = [];
    const forEach = (item: number) => acc.push(item);
    const arr1 = [1, 2, 3];
    const arr2 = [1, 2, 3];
    const arr3: number[] = [];

    forEachSortedArrays([arr1, arr2, arr3], (a, b) => a - b, forEach);
    expect(acc).toEqual([1, 1, 2, 2, 3, 3]);
  });
  it("merge arrays of all the same number and a sequence of numbers", () => {
    const acc: number[] = [];
    const forEach = (item: number) => acc.push(item);
    const arr1 = [3, 3, 3];
    const arr2 = [1, 2, 3, 4];
    const arr3: number[] = [];

    forEachSortedArrays([arr1, arr2, arr3], (a, b) => a - b, forEach);
    expect(acc).toEqual([1, 2, 3, 3, 3, 3, 4]);
  });
});

describe("convertMessage", () => {
  const mockMessageEvent = MessageEventBuilder.messageEvent();

  const createMockConverter = (overrides?: {
    fromSchemaName?: string;
    toSchemaName?: string;
    converter?: jest.Mock;
  }) => ({
    fromSchemaName: overrides?.fromSchemaName ?? "TestSchema",
    toSchemaName: overrides?.toSchemaName ?? "ConvertedSchema",
    converter: overrides?.converter ?? jest.fn((_msg: unknown) => ({ converted: 42 })),
  });

  it("should not convert when no converters match", () => {
    const converters = new Map();
    const convertedMessages: MessageEvent[] = [];

    convertMessage(mockMessageEvent, converters, convertedMessages);

    expect(convertedMessages).toHaveLength(0);
  });

  it("should convert message using matching converter", () => {
    const converter = createMockConverter();

    const converters = new Map([
      [`${mockMessageEvent.topic}\n${mockMessageEvent.schemaName}` as any, [converter]],
    ]);
    const convertedMessages: MessageEvent[] = [];

    convertMessage(mockMessageEvent, converters, convertedMessages);

    expect(convertedMessages).toHaveLength(1);
    expect(convertedMessages[0]).toMatchObject({
      topic: mockMessageEvent.topic,
      schemaName: converter.toSchemaName,
      message: { converted: 42 },
      receiveTime: mockMessageEvent.receiveTime,
      sizeInBytes: mockMessageEvent.sizeInBytes,
    });
    expect(converter.converter).toHaveBeenCalledWith(
      mockMessageEvent.message,
      mockMessageEvent,
      undefined,
      expect.objectContaining({
        emitAlert: expect.any(Function),
      }),
    );
  });

  it("should pass globalVariables to converter", () => {
    const globalVariables = GlobalVariableBuilder.globalVariables();
    const converter = createMockConverter({
      converter: jest.fn((_msg: unknown, _event: unknown, vars: unknown) => ({
        value: 42,
        vars,
      })),
    });
    const converters = new Map([
      [`${mockMessageEvent.topic}\n${mockMessageEvent.schemaName}` as any, [converter]],
    ]);
    const convertedMessages: MessageEvent[] = [];

    convertMessage(mockMessageEvent, converters, convertedMessages, globalVariables);

    expect(converter.converter).toHaveBeenCalledWith(
      mockMessageEvent.message,
      mockMessageEvent,
      globalVariables,
      expect.objectContaining({
        emitAlert: expect.any(Function),
      }),
    );
    expect((convertedMessages[0]?.message as any).vars).toEqual(globalVariables);
  });

  it("should apply multiple converters to same message", () => {
    const converter1 = createMockConverter({
      toSchemaName: "Schema1",
      converter: jest.fn(() => ({ output: 1 })),
    });
    const converter2 = createMockConverter({
      toSchemaName: "Schema2",
      converter: jest.fn(() => ({ output: 2 })),
    });

    const converters = new Map([
      [
        `${mockMessageEvent.topic}\n${mockMessageEvent.schemaName}` as any,
        [converter1, converter2],
      ],
    ]);
    const convertedMessages: MessageEvent[] = [];

    convertMessage(mockMessageEvent, converters, convertedMessages);

    expect(convertedMessages).toHaveLength(2);
    expect(convertedMessages[0]?.schemaName).toBe("Schema1");
    expect(convertedMessages[1]?.schemaName).toBe("Schema2");
  });

  it("should skip conversion when converter returns undefined", () => {
    const converter = createMockConverter({
      converter: jest.fn(() => undefined),
    });

    const converters = new Map([
      [`${mockMessageEvent.topic}\n${mockMessageEvent.schemaName}` as any, [converter]],
    ]);
    const convertedMessages: MessageEvent[] = [];

    convertMessage(mockMessageEvent, converters, convertedMessages);

    expect(convertedMessages).toHaveLength(0);
    expect(converter.converter).toHaveBeenCalled();
  });

  it("should skip conversion when converter returns null", () => {
    const converter = createMockConverter({
      converter: jest.fn(() => undefined),
    });

    const converters = new Map([
      [`${mockMessageEvent.topic}\n${mockMessageEvent.schemaName}` as any, [converter]],
    ]);
    const convertedMessages: MessageEvent[] = [];

    convertMessage(mockMessageEvent, converters, convertedMessages);

    expect(convertedMessages).toHaveLength(0);
  });

  it("should preserve originalMessageEvent in converted message", () => {
    const converter = createMockConverter({
      converter: jest.fn(() => ({ converted: true })),
    });

    const converters = new Map([
      [`${mockMessageEvent.topic}\n${mockMessageEvent.schemaName}` as any, [converter]],
    ]);
    const convertedMessages: MessageEvent[] = [];

    convertMessage(mockMessageEvent, converters, convertedMessages);

    expect(convertedMessages[0]?.originalMessageEvent).toBe(mockMessageEvent);
  });

  it("should preserve topicConfig in converted message", () => {
    const messageWithConfig = {
      ...mockMessageEvent,
      topicConfig: { someConfig: "value" },
    };

    const converter = createMockConverter({
      converter: jest.fn(() => ({ converted: true })),
    });

    const converters = new Map([
      [`${mockMessageEvent.topic}\n${mockMessageEvent.schemaName}` as any, [converter]],
    ]);
    const convertedMessages: MessageEvent[] = [];

    convertMessage(messageWithConfig, converters, convertedMessages);

    expect(convertedMessages[0]?.topicConfig).toEqual({ someConfig: "value" });
  });
});

describe("isTopicConverter", () => {
  it("accepts a fully-formed topic converter", () => {
    expect(isTopicConverter(makeTopicConverter())).toBe(true);
  });

  it("rejects schema converters and malformed topic converters", () => {
    const schemaConverter = {
      fromSchemaName: "A",
      toSchemaName: "B",
      converter: jest.fn(),
    } as unknown as InstalledMessageConverter;
    expect(isTopicConverter(schemaConverter)).toBe(false);
    // type:"topic" but missing required fields
    expect(
      isTopicConverter({ type: "topic", inputTopics: [] } as unknown as InstalledMessageConverter),
    ).toBe(false);
  });
});

describe("collateTopicConverters", () => {
  it("indexes converters by output and input topics", () => {
    const c1 = makeTopicConverter({ inputTopics: ["/a", "/b"], outputTopic: "/out1" });
    const c2 = makeTopicConverter({ inputTopics: ["/a"], outputTopic: "/out2" });

    const { byOutput, byInput } = collateTopicConverters([c1, c2]);

    expect([...byOutput.keys()].sort()).toEqual(["/out1", "/out2"]);
    expect(byInput.get("/a")).toHaveLength(2);
    expect(byInput.get("/b")).toHaveLength(1);
  });

  it("ignores non-topic converters", () => {
    const schema = {
      fromSchemaName: "A",
      toSchemaName: "B",
      converter: jest.fn(),
    } as unknown as InstalledMessageConverter;
    const { byOutput } = collateTopicConverters([schema]);
    expect(byOutput.size).toBe(0);
  });
});

describe("runTopicConverters", () => {
  const inputEvent = {
    ...MessageEventBuilder.messageEvent(),
    topic: "/in",
    message: { value: 1 },
  };

  it("produces an outputTopic message from a matching input", () => {
    const { byInput } = collateTopicConverters([makeTopicConverter()]);
    const out: MessageEvent[] = [];
    runTopicConverters(inputEvent, byInput, new Map(), out);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      topic: "/out",
      schemaName: "foxglove.SceneUpdate",
      message: { derived: inputEvent.message },
      receiveTime: inputEvent.receiveTime,
    });
    expect(out[0]?.originalMessageEvent).toBe(inputEvent);
  });

  it("supports one input fanning out to multiple output topics", () => {
    const convs = [
      makeTopicConverter({ outputTopic: "/out1" }),
      makeTopicConverter({ outputTopic: "/out2" }),
    ];
    const { byInput } = collateTopicConverters(convs);
    const out: MessageEvent[] = [];
    runTopicConverters(inputEvent, byInput, new Map(), out);
    expect(out.map((m) => m.topic).sort()).toEqual(["/out1", "/out2"]);
  });

  it("flattens array results and skips undefined entries", () => {
    const conv = makeTopicConverter({
      create: () => () => [{ a: 1 }, undefined, { a: 2 }],
    });
    const { byInput } = collateTopicConverters([conv]);
    const out: MessageEvent[] = [];
    runTopicConverters(inputEvent, byInput, new Map(), out);
    expect(out.map((m) => m.message)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("caches the create() instance across calls and reuses it", () => {
    const inner = jest.fn(() => ({ ok: true }));
    const create = jest.fn(() => inner);
    const conv = makeTopicConverter({ create });
    const { byInput } = collateTopicConverters([conv]);
    const fnCache: Parameters<typeof runTopicConverters>[2] = new Map();

    runTopicConverters(inputEvent, byInput, fnCache, []);
    runTopicConverters(inputEvent, byInput, fnCache, []);

    expect(create).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("skips when the create() result returns undefined", () => {
    const conv = makeTopicConverter({ create: () => () => undefined });
    const { byInput } = collateTopicConverters([conv]);
    const out: MessageEvent[] = [];
    runTopicConverters(inputEvent, byInput, new Map(), out);
    expect(out).toHaveLength(0);
  });

  it("emits an alert and continues when the converter throws", () => {
    const conv = makeTopicConverter({
      create: () => () => {
        throw new Error("boom");
      },
    });
    const { byInput } = collateTopicConverters([conv]);
    const out: MessageEvent[] = [];
    const emitAlert = jest.fn();
    runTopicConverters(inputEvent, byInput, new Map(), out, undefined, { emitAlert });
    expect(out).toHaveLength(0);
    expect(emitAlert).toHaveBeenCalledTimes(1);
  });
});

describe("collateTopicSchemaConversions with topic converters", () => {
  it("excludes topic-converter outputTopics from unconvertedSubscriptionTopics", () => {
    const conv = makeTopicConverter({ inputTopics: ["/in"], outputTopic: "/out" });
    const { unconvertedSubscriptionTopics } = collateTopicSchemaConversions(
      [{ topic: "/out" }, { topic: "/plain" }],
      [{ name: "/in", schemaName: "S" }],
      [conv],
    );
    expect(unconvertedSubscriptionTopics.has("/out")).toBe(false);
    expect(unconvertedSubscriptionTopics.has("/plain")).toBe(true);
  });
});

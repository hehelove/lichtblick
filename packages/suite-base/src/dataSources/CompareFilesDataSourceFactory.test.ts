// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
/** @jest-environment jsdom */

import { IterablePlayer } from "@lichtblick/suite-base/players/IterablePlayer";
import { CompareIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/CompareIterableSource";

import CompareFilesDataSourceFactory, {
  COMPARE_EXTENSIONS,
  COMPARE_SOURCE_ID,
} from "./CompareFilesDataSourceFactory";
import { useCompareStore } from "./compareStore";

jest.mock("./McapLocalDataSourceFactory", () => ({
  buildMcapSource: jest.fn(() => ({ kind: "mcap" })),
}));
jest.mock("./Ros1LocalBagDataSourceFactory", () => ({
  buildRos1BagSource: jest.fn(() => ({ kind: "ros1" })),
}));
jest.mock("./Ros2LocalBagDataSourceFactory", () => ({
  buildRos2BagSource: jest.fn(() => ({ kind: "ros2" })),
}));
jest.mock("./UlogLocalDataSourceFactory", () => ({
  buildUlogSource: jest.fn(() => ({ kind: "ulog" })),
}));
jest.mock("@lichtblick/suite-base/players/IterablePlayer/DeserializingIterableSource", () => ({
  DeserializingIterableSource: jest.fn(function (this: { wrapped: unknown }, wrapped: unknown) {
    this.wrapped = wrapped;
  }),
}));
jest.mock("@lichtblick/suite-base/players/IterablePlayer", () => ({
  IterablePlayer: jest.fn(),
}));
jest.mock("@lichtblick/suite-base/players/IterablePlayer/CompareIterableSource", () => ({
  CompareIterableSource: jest.fn(function (this: { options: unknown }, options: unknown) {
    this.options = options;
  }),
}));

function makeFile(name: string): File {
  return new File(["x"], name, { type: "application/octet-stream" });
}

describe("CompareFilesDataSourceFactory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useCompareStore.getState().endSession();
  });

  it("routes each file extension to its buildSource seam", () => {
    const factory = new CompareFilesDataSourceFactory();
    factory.initialize({
      metricsCollector: undefined as never,
      files: [makeFile("a.mcap"), makeFile("b.bag"), makeFile("c.db3")],
    });
    const source = (CompareIterableSource as unknown as jest.Mock).mock.instances[0] as {
      options: { slots: Array<{ slot: string; fileName: string }> };
    };
    expect(source.options.slots.map((s) => `${s.slot}:${s.fileName}`)).toEqual([
      "A:a.mcap",
      "B:b.bag",
      "C:c.db3",
    ]);
  });

  it("rejects more than three files with a clear error", () => {
    const factory = new CompareFilesDataSourceFactory();
    expect(() =>
      factory.initialize({
        metricsCollector: undefined as never,
        files: [makeFile("a.mcap"), makeFile("b.bag"), makeFile("c.db3"), makeFile("d.ulg")],
      }),
    ).toThrow(/at most 3/i);
  });

  it("assigns slots A,B,C by file order and passes a stable playerId to IterablePlayer", () => {
    const factory = new CompareFilesDataSourceFactory();
    factory.initialize({
      metricsCollector: undefined as never,
      files: [makeFile("a.mcap"), makeFile("b.bag")],
    });
    const state = useCompareStore.getState();
    expect(state.active).toEqual(true);
    expect(state.slots.map((s) => s.slot)).toEqual(["A", "B"]);
    const playerArgs = (IterablePlayer as jest.Mock).mock.calls[0]![0] as {
      playerId: string;
      sourceId: string;
      name: string;
    };
    expect(playerArgs.playerId).toEqual(state.playerId);
    expect(playerArgs.sourceId).toEqual(COMPARE_SOURCE_ID);
    expect(playerArgs.name).toEqual("Comparison: a.mcap, b.bag");
  });

  it("treats the same File objects in the same order as a rebuild: offsets survive, playerId stable", () => {
    const factory = new CompareFilesDataSourceFactory();
    const a = makeFile("a.mcap");
    const b = makeFile("b.bag");
    factory.initialize({ metricsCollector: undefined as never, files: [a, b] });
    const before = useCompareStore.getState().playerId;
    useCompareStore.getState().setOffset("A", 5_000_000_000n);
    factory.initialize({ metricsCollector: undefined as never, files: [a, b] });
    const state = useCompareStore.getState();
    expect(state.playerId).toEqual(before);
    expect(state.slots.find((s) => s.slot === "A")?.offsetNs).toEqual(5_000_000_000n);
    const options = (CompareIterableSource as unknown as jest.Mock).mock.instances.at(-1) as {
      options: { offsets: Map<string, bigint> };
    };
    expect(options.options.offsets.get("A")).toEqual(5_000_000_000n);
  });

  it("starts a fresh session for different files", () => {
    const factory = new CompareFilesDataSourceFactory();
    factory.initialize({
      metricsCollector: undefined as never,
      files: [makeFile("a.mcap")],
    });
    const before = useCompareStore.getState().playerId;
    factory.initialize({
      metricsCollector: undefined as never,
      files: [makeFile("z.mcap")],
    });
    const state = useCompareStore.getState();
    expect(state.slots[0]?.fileName).toEqual("z.mcap");
    expect(state.slots[0]?.offsetNs).toEqual(0n);
    expect(state.playerId).toEqual(before); // playerId 复用直至 endSession
  });

  it("rejects unsupported extensions naming every offending file", () => {
    const factory = new CompareFilesDataSourceFactory();
    expect(() =>
      factory.initialize({
        metricsCollector: undefined as never,
        files: [makeFile("a.mcap"), makeFile("notes.txt")],
      }),
    ).toThrow(/notes\.txt/);
  });

  it("exposes exactly the supported comparison extensions", () => {
    expect([...COMPARE_EXTENSIONS].sort()).toEqual([".bag", ".db3", ".mcap", ".ulg", ".ulog"]);
  });

  it("accepts args.file (single-file form) like McapLocalDataSourceFactory does", () => {
    const factory = new CompareFilesDataSourceFactory();
    factory.initialize({
      metricsCollector: undefined as never,
      file: makeFile("solo.mcap"),
    });
    expect(useCompareStore.getState().slots[0]?.slot).toEqual("A");
  });
});

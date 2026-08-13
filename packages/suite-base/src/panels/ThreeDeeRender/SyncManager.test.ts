// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fromNanoSec } from "@lichtblick/rostime";
import { MessageEvent } from "@lichtblick/suite";

import { SyncManager } from "./SyncManager";

function message(topic: string, timestamp: bigint): MessageEvent {
  return {
    topic,
    schemaName: "test.Message",
    receiveTime: fromNanoSec(timestamp),
    message: { header: { stamp: fromNanoSec(timestamp) } },
    sizeInBytes: 0,
  };
}

function sceneUpdate(
  topic: string,
  update: {
    entities?: { timestamp: ReturnType<typeof fromNanoSec> }[];
    deletions?: { timestamp: ReturnType<typeof fromNanoSec> }[];
  },
): MessageEvent {
  return {
    ...message(topic, 0n),
    schemaName: "foxglove.SceneUpdate",
    message: update,
  };
}

describe("SyncManager", () => {
  it("releases messages only when every synchronized topic has the exact same timestamp", () => {
    const manager = new SyncManager();
    manager.setTopics(new Set(["/a", "/b"]));

    expect(manager.addMessageEvent(message("/a", 1n))).toEqual([]);
    expect(manager.addMessageEvent(message("/b", 2n))).toEqual([]);
    expect(manager.addMessageEvent(message("/b", 1n))).toEqual([
      expect.objectContaining({ topic: "/a" }),
      expect.objectContaining({ topic: "/b" }),
    ]);
  });

  it("passes through messages from topics that are not synchronized", () => {
    const manager = new SyncManager();
    manager.setTopics(new Set(["/a", "/b"]));
    const event = message("/other", 1n);

    expect(manager.addMessageEvent(event)).toEqual([event]);
  });

  it("does not pass through a synchronized topic message without a timestamp", () => {
    const manager = new SyncManager();
    manager.setTopics(new Set(["/a", "/b"]));
    const event = { ...message("/a", 1n), message: {} };

    expect(manager.addMessageEvent(event)).toEqual([]);
  });

  it("keeps at most 250 unique incomplete timestamps", () => {
    const manager = new SyncManager();
    manager.setTopics(new Set(["/a", "/b"]));
    for (let i = 0n; i <= 250n; i++) {
      manager.addMessageEvent(message("/a", i));
    }

    expect(manager.addMessageEvent(message("/b", 1n))).toHaveLength(2);
    expect(manager.addMessageEvent(message("/b", 0n))).toEqual([]);
  });

  it("clears incomplete timestamps when synchronized topics change", () => {
    const manager = new SyncManager();
    manager.setTopics(new Set(["/a", "/b"]));
    manager.addMessageEvent(message("/a", 1n));

    manager.setTopics(new Set(["/a", "/c"]));
    manager.setTopics(new Set(["/a", "/b"]));

    expect(manager.addMessageEvent(message("/b", 1n))).toEqual([]);
  });

  it("uses a top-level Foxglove timestamp", () => {
    const manager = new SyncManager();
    manager.setTopics(new Set(["/a", "/b"]));
    const a = { ...message("/a", 5n), message: { timestamp: fromNanoSec(3n) } };
    const b = { ...message("/b", 6n), message: { timestamp: fromNanoSec(3n) } };

    expect(manager.addMessageEvent(a)).toEqual([]);
    expect(manager.addMessageEvent(b)).toHaveLength(2);
  });

  it("uses the first entity timestamp for foxglove.SceneUpdate exact matching", () => {
    const manager = new SyncManager();
    manager.setTopics(new Set(["/a", "/b"]));

    expect(
      manager.addMessageEvent(
        sceneUpdate("/a", {
          entities: [{ timestamp: fromNanoSec(3n) }, { timestamp: fromNanoSec(4n) }],
          deletions: [{ timestamp: fromNanoSec(5n) }],
        }),
      ),
    ).toEqual([]);
    expect(
      manager.addMessageEvent(sceneUpdate("/b", { entities: [{ timestamp: fromNanoSec(3n) }] })),
    ).toHaveLength(2);
  });

  it("uses the first deletion timestamp when a foxglove.SceneUpdate has no entities", () => {
    const manager = new SyncManager();
    manager.setTopics(new Set(["/a", "/b"]));

    expect(
      manager.addMessageEvent(sceneUpdate("/a", { deletions: [{ timestamp: fromNanoSec(7n) }] })),
    ).toEqual([]);
    expect(
      manager.addMessageEvent(sceneUpdate("/b", { deletions: [{ timestamp: fromNanoSec(7n) }] })),
    ).toHaveLength(2);
  });

  it("passes through an empty foxglove.SceneUpdate instead of retaining stale scene state", () => {
    const manager = new SyncManager();
    manager.setTopics(new Set(["/a", "/b"]));
    const event = sceneUpdate("/a", { entities: [], deletions: [] });

    expect(manager.addMessageEvent(event)).toEqual([event]);
  });

  it("does not interpret entities on other schemas as a SceneUpdate timestamp", () => {
    const manager = new SyncManager();
    manager.setTopics(new Set(["/a", "/b"]));
    const event = {
      ...message("/a", 0n),
      message: { entities: [{ timestamp: fromNanoSec(3n) }] },
    };

    expect(manager.addMessageEvent(event)).toEqual([]);
  });
});

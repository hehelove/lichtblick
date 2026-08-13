// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { caseEventsToPositioned } from "./XsEvalEventsBridge";

const startTime = { sec: 10, nsec: 0 };
const endTime = { sec: 20, nsec: 0 };

describe("caseEventsToPositioned", () => {
  it("supplies defaults for missing event fields", () => {
    const [event] = caseEventsToPositioned({ list: [{}] }, startTime, endTime);

    expect(event).toMatchObject({
      startPosition: 0,
      endPosition: 0,
      secondsSinceStart: 0,
      event: {
        metadata: {
          type: "",
          severity: "info",
          message: "",
        },
        startTime,
      },
    });
  });

  it.each([
    ["non-number", "0.5", 0],
    ["NaN", Number.NaN, 0],
    ["positive infinity", Number.POSITIVE_INFINITY, 0],
    ["below zero", -0.5, 0],
    ["above one", 1.5, 1],
  ])("normalizes %s frac", (_name, frac, expected) => {
    const [event] = caseEventsToPositioned({ list: [{ frac }] }, startTime, endTime);

    expect(event?.startPosition).toBe(expected);
    expect(event?.secondsSinceStart).toBe(expected * 10);
  });

  it("only writes supported string metadata and ignores unknown fields", () => {
    const [event] = caseEventsToPositioned(
      {
        list: [
          {
            id: 7,
            frac: 0.5,
            type: 42,
            severity: null,
            message: { text: "bad" },
            category: 3,
            source: ["metric"],
            trackId: Number.NaN,
            threshold: { limit: 3 },
            actual: { value: 4 },
            unknown: "ignored",
          },
        ],
      },
      startTime,
      endTime,
    );

    expect(event?.event.metadata).toEqual({
      type: "",
      severity: "info",
      message: "",
      threshold: '{"limit":3}',
      actual: '{"value":4}',
    });
    expect(
      Object.values(event?.event.metadata ?? {}).every((value) => typeof value === "string"),
    ).toBe(true);
  });
});

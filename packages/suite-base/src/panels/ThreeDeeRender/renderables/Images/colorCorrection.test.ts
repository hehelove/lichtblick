// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { parseColorCorrectionRecords } from "./colorCorrection";

describe("parseColorCorrectionRecords", () => {
  it("parses a well-formed record into a topic and 9-entry row-major matrix", () => {
    const matrix = {
      m00: "1",
      m01: "0.5",
      m02: "0",
      m10: "-0.2",
      m11: "1",
      m12: "0.1",
      m20: "0",
      m21: "0",
      m22: "1",
    };
    const result = parseColorCorrectionRecords([
      { name: "foxglove.raw_image_color_correction", metadata: { topic: "/camera", ...matrix } },
    ]);
    expect(result).toEqual([{ topic: "/camera", matrix: [1, 0.5, 0, -0.2, 1, 0.1, 0, 0, 1] }]);
  });

  it("returns multiple records and ignores other metadata names", () => {
    const result = parseColorCorrectionRecords([
      { name: "foxglove.raw_image_color_correction", metadata: mkMatrix("/a") },
      { name: "some_other_record", metadata: mkMatrix("/ignored") },
      { name: "foxglove.raw_image_color_correction", metadata: mkMatrix("/b") },
    ]);
    expect(result.map((entry) => entry.topic)).toEqual(["/a", "/b"]);
  });

  it("ignores malformed entries (NaN, missing keys, missing topic)", () => {
    const nanM00 = { ...mkMatrix("/nan"), m00: "not-a-number" };
    const missingKey = mkMatrix("/missing");
    delete missingKey.m22;
    const noTopic = { ...mkMatrix(""), topic: undefined as unknown as string };
    const result = parseColorCorrectionRecords([
      { name: "foxglove.raw_image_color_correction", metadata: nanM00 },
      { name: "foxglove.raw_image_color_correction", metadata: missingKey },
      { name: "foxglove.raw_image_color_correction", metadata: noTopic },
    ]);
    expect(result).toEqual([]);
  });
});

function mkMatrix(topic: string): Record<string, string> {
  return {
    topic,
    m00: "1",
    m01: "0",
    m02: "0",
    m10: "0",
    m11: "0",
    m12: "1",
    m20: "0",
    m21: "1",
    m22: "0",
  };
}

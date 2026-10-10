// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { decodeG711Alaw, decodeG711Ulaw } from "./g711";

// Reference values follow the ITU-T G.711 / G.191 (g711.c) decoder convention:
// A-law expands to 13-bit PCM scaled <<3 into Int16, u-law to 14-bit scaled <<2.
const ALAW_TABLE = decodeG711Alaw(Uint8Array.from({ length: 256 }, (_, i) => i));
const ULAW_TABLE = decodeG711Ulaw(Uint8Array.from({ length: 256 }, (_, i) => i));

describe("decodeG711Alaw", () => {
  it("decodes known A-law vectors", () => {
    // 0xd5 xor 0x55 = 0x80: positive, segment 0, mantissa 0 -> smallest positive step (2m+1)<<3.
    expect(ALAW_TABLE[0xd5]!).toBe(8);
    // 0x55 xor 0x55 = 0x00: negative counterpart of 0xd5 (differs only in the sign bit) -> -8.
    expect(ALAW_TABLE[0x55]!).toBe(-8);
    // Full-scale positive: 0xaa xor 0x55 = 0xff -> segment 7, mantissa 15.
    expect(ALAW_TABLE[0xaa]!).toBe(32256);
    expect(ALAW_TABLE[0x2a]!).toBe(-32256);
    // Mid-table vector: 0x80 xor 0x55 = 0xd5 -> segment 5, mantissa 5.
    expect(ALAW_TABLE[0x80]!).toBe(5504);
  });

  it("flipping the sign bit negates the sample", () => {
    for (let i = 0; i < 256; i++) {
      expect(ALAW_TABLE[i ^ 0x80]!).toBe(-ALAW_TABLE[i]!);
    }
  });

  it("is monotonic within each sign half", () => {
    // Positive half: internal codes 0x80..0xff (wire = internal ^ 0x55) increase strictly.
    for (let k = 1; k < 128; k++) {
      expect(ALAW_TABLE[0x55 ^ (0x80 | k)]!).toBeGreaterThan(ALAW_TABLE[0x55 ^ (0x80 | (k - 1))]!);
      // Negative half: internal codes 0x00..0x7f decrease strictly (magnitude grows).
      expect(ALAW_TABLE[0x55 ^ k]!).toBeLessThan(ALAW_TABLE[0x55 ^ (k - 1)]!);
    }
  });
});

describe("decodeG711Ulaw", () => {
  it("decodes known u-law vectors", () => {
    expect(ULAW_TABLE[0xff]!).toBe(0); // +0: ~0xff = 0x00, chord 0, mantissa 0
    expect(ULAW_TABLE[0x7f]!).toBe(0); // -0: ~0x7f = 0x80, same magnitude class as 0xff
    expect(ULAW_TABLE[0xfe]!).toBe(8); // ~0xfe = 0x01: first step above zero
    expect(ULAW_TABLE[0x80]!).toBe(32124); // full-scale positive
    expect(ULAW_TABLE[0x00]!).toBe(-32124); // full-scale negative
  });

  it("flipping the sign bit negates the sample", () => {
    // `| 0` collapses the -0 produced by negating the +0/-0 codeword pair.
    for (let i = 0; i < 256; i++) {
      expect(ULAW_TABLE[i ^ 0x80]!).toBe(-ULAW_TABLE[i]! | 0);
    }
  });

  it("is monotonic within each sign half", () => {
    // Positive half: inverted codes ~k for k in 0x00..0x7f increase strictly.
    for (let k = 1; k < 128; k++) {
      expect(ULAW_TABLE[~k & 0xff]!).toBeGreaterThan(ULAW_TABLE[~(k - 1) & 0xff]!);
      // Negative half: inverted codes 0x80..0xff decrease strictly.
      expect(ULAW_TABLE[~(0x80 | k) & 0xff]!).toBeLessThan(ULAW_TABLE[~(0x80 | (k - 1)) & 0xff]!);
    }
  });
});

describe("sample count", () => {
  it("preserves sample count", () => {
    for (const length of [0, 1, 2, 8000]) {
      const data = Uint8Array.from({ length }, (_, i) => (i * 37) & 0xff);
      expect(decodeG711Alaw(data)).toHaveLength(length);
      expect(decodeG711Ulaw(data)).toHaveLength(length);
    }
  });

  it("decodes byte-by-byte consistently with the full table", () => {
    const data = Uint8Array.from([0x00, 0x55, 0x7f, 0x80, 0xaa, 0xd5, 0xfe, 0xff]);
    const alaw = decodeG711Alaw(data);
    const ulaw = decodeG711Ulaw(data);
    for (let i = 0; i < data.length; i++) {
      expect(alaw[i]).toBe(ALAW_TABLE[data[i]!]);
      expect(ulaw[i]).toBe(ULAW_TABLE[data[i]!]);
    }
  });
});

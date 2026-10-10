// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * ITU-T G.711 decode tables, built programmatically at module load following the ITU-T G.191
 * reference decoder (g711.c):
 *
 * - A-law: the wire byte is XORed with 0x55 (even-bit inversion), then expanded from
 *   sign/segment/mantissa to 13-bit linear PCM scaled left by 3 into Int16 range.
 *   Segment 0 decodes to `(2*mantissa + 1) << 3`; segments 1-7 to `((mantissa << 4) + 0x108)
 *   << (segment - 1)` (equivalently `((2*mantissa + 33) << (segment - 1)) << 3`).
 *   The sign bit (bit 7, untouched by the 0x55 xor) set means a positive sample.
 * - u-law: the wire byte is one's-complemented, then expanded from sign/chord/mantissa to
 *   14-bit linear PCM scaled left by 2 into Int16 range: `((mantissa << 3) + 0x84) << chord`,
 *   with the 0x84 (33 << 2) bias removed symmetrically on both signs.
 */
const ALAW_TABLE = new Int16Array(256);
const ULAW_TABLE = new Int16Array(256);

for (let byte = 0; byte < 256; byte++) {
  {
    const a = byte ^ 0x55;
    const segment = (a & 0x70) >> 4;
    const mantissa = a & 0x0f;
    const sample =
      segment === 0 ? (mantissa << 4) + 8 : ((mantissa << 4) + 0x108) << (segment - 1);
    ALAW_TABLE[byte] = (a & 0x80) !== 0 ? sample : -sample;
  }
  {
    const u = ~byte & 0xff;
    let sample = ((u & 0x0f) << 3) + 0x84;
    sample <<= (u & 0x70) >> 4;
    ULAW_TABLE[byte] = (u & 0x80) !== 0 ? 0x84 - sample : sample - 0x84;
  }
}

/**
 * Decodes 8-bit ITU-T G.711 A-law samples into 16-bit linear PCM (13-bit values scaled <<3),
 * one output sample per input byte.
 */
export function decodeG711Alaw(data: Uint8Array): Int16Array {
  const out = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = ALAW_TABLE[data[i]!]!;
  }
  return out;
}

/**
 * Decodes 8-bit ITU-T G.711 u-law samples into 16-bit linear PCM (14-bit values scaled <<2),
 * one output sample per input byte.
 */
export function decodeG711Ulaw(data: Uint8Array): Int16Array {
  const out = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = ULAW_TABLE[data[i]!]!;
  }
  return out;
}

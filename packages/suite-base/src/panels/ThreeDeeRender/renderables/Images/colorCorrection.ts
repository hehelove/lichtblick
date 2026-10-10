// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Name of the MCAP metadata record that overrides the color-correction matrix for `rccg12`
 * images (Foxglove convention). The record carries string-valued keys `topic` and `m00`..`m22`
 * (row-major 3x3 matrix mapping measured [R, Clear, G] to displayed [R, G, B]).
 */
export const COLOR_CORRECTION_METADATA_NAME = "foxglove.raw_image_color_correction";

/**
 * Extracts color-correction matrices from player metadata records.
 *
 * Malformed entries are ignored rather than rejected: records with another name, a missing/empty
 * `topic`, or any missing/non-numeric `m00`..`m22` key are skipped so a single bad record cannot
 * suppress the matrices of other topics in the same file.
 */
export function parseColorCorrectionRecords(
  metadata: readonly { name: string; metadata: Record<string, string> }[],
): { topic: string; matrix: number[] }[] {
  const result: { topic: string; matrix: number[] }[] = [];
  for (const record of metadata) {
    if (record.name !== COLOR_CORRECTION_METADATA_NAME) {
      continue;
    }
    const topic = record.metadata["topic"];
    if (topic == undefined || topic.length === 0) {
      continue;
    }
    const matrix: number[] = [];
    let valid = true;
    for (let i = 0; i < 9 && valid; i++) {
      const raw = record.metadata[`m${Math.floor(i / 3)}${i % 3}`];
      const value = raw != undefined ? parseFloat(raw) : Number.NaN;
      if (Number.isNaN(value)) {
        valid = false;
      } else {
        matrix.push(value);
      }
    }
    if (valid) {
      result.push({ topic, matrix });
    }
  }
  return result;
}

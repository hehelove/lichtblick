// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const CANONICAL_FORMATS = new Set([
  "pcm-s16",
  "g711-alaw",
  "g711-ulaw",
  "opus",
  "mp4a.40.2",
]);

/**
 * Canonical audio format identifier used internally so callers do not need to deal with
 * case/whitespace variants of the format strings produced by different data sources.
 * Returns undefined for formats we have no decode path for, so unsupported formats never
 * get a silent fallback.
 */
export function canonicalAudioFormat(
  format: string,
): "pcm-s16" | "g711-alaw" | "g711-ulaw" | "opus" | "mp4a.40.2" | undefined {
  const normalized = format.trim().toLowerCase();
  return CANONICAL_FORMATS.has(normalized)
    ? (normalized as "pcm-s16" | "g711-alaw" | "g711-ulaw" | "opus" | "mp4a.40.2")
    : undefined;
}

/** True for formats decodable directly from raw sample bytes without a platform decoder. */
export function isRawAudioFormat(format: string): boolean {
  const canonical = canonicalAudioFormat(format);
  return (
    canonical === "pcm-s16" || canonical === "g711-alaw" || canonical === "g711-ulaw"
  );
}

/** True for formats that must go through a compressed audio decoder (WebCodecs). */
export function isCompressedAudioFormat(format: string): boolean {
  const canonical = canonicalAudioFormat(format);
  return canonical === "opus" || canonical === "mp4a.40.2";
}

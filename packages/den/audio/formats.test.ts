// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { canonicalAudioFormat, isCompressedAudioFormat, isRawAudioFormat } from "./formats";

describe("canonicalAudioFormat", () => {
  it("returns the five known formats unchanged", () => {
    expect(canonicalAudioFormat("pcm-s16")).toBe("pcm-s16");
    expect(canonicalAudioFormat("g711-alaw")).toBe("g711-alaw");
    expect(canonicalAudioFormat("g711-ulaw")).toBe("g711-ulaw");
    expect(canonicalAudioFormat("opus")).toBe("opus");
    expect(canonicalAudioFormat("mp4a.40.2")).toBe("mp4a.40.2");
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(canonicalAudioFormat("PCM-S16")).toBe("pcm-s16");
    expect(canonicalAudioFormat("G711-ALAW")).toBe("g711-alaw");
    expect(canonicalAudioFormat("  G711-uLAW ")).toBe("g711-ulaw");
    expect(canonicalAudioFormat("Opus")).toBe("opus");
    expect(canonicalAudioFormat("MP4A.40.2")).toBe("mp4a.40.2");
  });

  it("returns undefined for unsupported formats", () => {
    expect(canonicalAudioFormat("wav")).toBeUndefined();
    expect(canonicalAudioFormat("g726-32k")).toBeUndefined();
    expect(canonicalAudioFormat("pcm_f32le")).toBeUndefined();
    expect(canonicalAudioFormat("")).toBeUndefined();
    expect(canonicalAudioFormat("audio/pcm;samplesize=16")).toBeUndefined();
  });
});

describe("isRawAudioFormat", () => {
  it("is true only for the raw (self-decodable) formats", () => {
    expect(isRawAudioFormat("pcm-s16")).toBe(true);
    expect(isRawAudioFormat("g711-alaw")).toBe(true);
    expect(isRawAudioFormat("g711-ulaw")).toBe(true);
    expect(isRawAudioFormat("PCM-S16")).toBe(true);
  });

  it("is false for compressed and unknown formats", () => {
    expect(isRawAudioFormat("opus")).toBe(false);
    expect(isRawAudioFormat("mp4a.40.2")).toBe(false);
    expect(isRawAudioFormat("wav")).toBe(false);
  });
});

describe("isCompressedAudioFormat", () => {
  it("is true only for the compressed formats", () => {
    expect(isCompressedAudioFormat("opus")).toBe(true);
    expect(isCompressedAudioFormat("mp4a.40.2")).toBe(true);
    expect(isCompressedAudioFormat("OPUS")).toBe(true);
  });

  it("is false for raw and unknown formats", () => {
    expect(isCompressedAudioFormat("pcm-s16")).toBe(false);
    expect(isCompressedAudioFormat("g711-alaw")).toBe(false);
    expect(isCompressedAudioFormat("wav")).toBe(false);
  });
});

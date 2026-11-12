// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  canonicalAudioFormat,
  decodeG711Alaw,
  decodeG711Ulaw,
} from "@lichtblick/den/audio";

import { CompressedAudioLike, RawAudioLike } from "./types";

export type DecodedAudio = {
  /** One entry per channel; entries share the same length. */
  channels: Int16Array[];
  sampleRate: number;
};

function deinterleave(samples: Int16Array, channelCount: number): Int16Array[] {
  if (channelCount <= 1) {
    return [samples];
  }
  const length = Math.floor(samples.length / channelCount);
  const channels: Int16Array[] = [];
  for (let channel = 0; channel < channelCount; channel++) {
    const out = new Int16Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = samples[i * channelCount + channel]!;
    }
    channels.push(out);
  }
  return channels;
}

/**
 * Decodes a foxglove.RawAudio message to planar 16-bit PCM. Handles pcm-s16 (little-endian
 * interleaved) natively and dispatches g711-alaw/g711-ulaw to the den decoders. Formats with no
 * decode path (e.g. g726-*, aal2-*) throw instead of degrading silently.
 */
export function decodeRawAudio(msg: RawAudioLike): DecodedAudio {
  const format = canonicalAudioFormat(msg.format);
  if (format !== "pcm-s16" && format !== "g711-alaw" && format !== "g711-ulaw") {
    throw new Error(`Unsupported raw audio format: ${msg.format}`);
  }

  let samples: Int16Array;
  if (format === "pcm-s16") {
    const sampleCount = Math.floor(msg.data.byteLength / 2);
    samples = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = msg.data[i * 2]! | (msg.data[i * 2 + 1]! << 8);
    }
  } else {
    samples = format === "g711-alaw" ? decodeG711Alaw(msg.data) : decodeG711Ulaw(msg.data);
  }

  const channelCount = Math.max(1, msg.number_of_channels);
  return { channels: deinterleave(samples, channelCount), sampleRate: msg.sample_rate };
}

export type AudioFrame = {
  data: Int16Array;
  sampleCount: number;
  sampleRate?: number;
};

const CODEC_STRINGS: Record<"opus" | "mp4a.40.2", string> = {
  "opus": "opus",
  "mp4a.40.2": "mp4a.40.2",
};

/**
 * Wraps the WebCodecs AudioDecoder for opus/AAC payloads. Guards `typeof AudioDecoder` so hosts
 * without WebCodecs get a rejected promise (message matching /unsupported/) rather than a crash.
 */
export class CompressedAudioDecoder {
  private decoder: AudioDecoder | undefined;
  private configured = false;
  private pendingError: Error | undefined;

  public constructor(
    private format: "opus" | "mp4a.40.2",
    private onFrame: (frame: AudioFrame) => void,
  ) {}

  private handleOutput = (audioData: AudioData): void => {
    const sampleCount = audioData.numberOfFrames;
    const channelCount = Math.max(1, audioData.numberOfChannels);
    const dest = new Int16Array(sampleCount * channelCount);
    audioData.copyTo(dest, { planeIndex: 0, format: "s16" });
    this.onFrame({
      data: dest,
      sampleCount,
      sampleRate: audioData.sampleRate,
    });
    audioData.close();
  };

  private handleError = (error: DOMException): void => {
    this.pendingError ??= new Error(`AudioDecoder error while decoding ${this.format}: ${error}`);
  };

  // Reads through a method so control-flow narrowing of `pendingError` (which is stale across the
  // async error callback) does not hide errors set while a decode is in flight.
  private readError(): Error | undefined {
    return this.pendingError;
  }

  public async decode(msg: CompressedAudioLike): Promise<void> {
    if (typeof AudioDecoder === "undefined") {
      throw new Error(
        `Unsupported: WebCodecs AudioDecoder is not available in this environment, cannot decode ${this.format}`,
      );
    }

    if (this.decoder?.state === "closed") {
      // A fatal error auto-closed the decoder; rebuild it so one bad chunk doesn't poison every
      // later chunk of this format for the panel's lifetime.
      this.decoder = undefined;
      this.configured = false;
      this.pendingError = undefined;
    }
    this.decoder ??= new AudioDecoder({ output: this.handleOutput, error: this.handleError });
    if (!this.configured) {
      // foxglove.CompressedAudio carries no sample_rate/channels; opus signals both in-band, so
      // these are hints for codecs that want them.
      this.decoder.configure({
        codec: CODEC_STRINGS[this.format],
        sampleRate: 48000,
        numberOfChannels: 1,
      });
      this.configured = true;
    }
    const existingError = this.readError();
    if (existingError != undefined) {
      throw existingError;
    }

    // ponytail: flush per message keeps frame ordering deterministic and memory bounded; batch
    // chunks behind a single flush if profiling shows per-chunk latency matters.
    this.decoder.decode(makeEncodedChunk(msg));
    await this.decoder.flush();

    const pendingError = this.readError();
    if (pendingError != undefined) {
      throw pendingError;
    }
  }

  public dispose(): void {
    if (this.decoder != undefined && this.decoder.state !== "closed") {
      this.decoder.close();
    }
    this.decoder = undefined;
    this.configured = false;
  }
}

function makeEncodedChunk(msg: CompressedAudioLike): EncodedAudioChunk {
  const timestamp = msg.timestamp.sec * 1_000_000 + Math.round(msg.timestamp.nsec / 1000);
  if (typeof EncodedAudioChunk !== "undefined") {
    return new EncodedAudioChunk({ type: "key", timestamp, data: msg.data });
  }
  // Duck-typed fallback for hosts/tests without EncodedAudioChunk.
  return { type: "key", timestamp, data: msg.data } as unknown as EncodedAudioChunk;
}

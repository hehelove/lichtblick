// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { AudioFrame, CompressedAudioDecoder, decodeRawAudio } from "./decoding";
import { CompressedAudioLike, RawAudioLike } from "./types";

function rawAudio(overrides: Partial<RawAudioLike>): RawAudioLike {
  return {
    timestamp: { sec: 0, nsec: 0 },
    format: "pcm-s16",
    sample_rate: 48000,
    number_of_channels: 1,
    data: new Uint8Array(0),
    ...overrides,
  };
}

describe("decodeRawAudio", () => {
  it("splits interleaved pcm-s16 LE into channels", () => {
    const msg = rawAudio({
      number_of_channels: 2,
      data: Uint8Array.from([0x01, 0x00, 0x00, 0x80, 0x02, 0x00, 0x00, 0x80]),
    });
    const { channels, sampleRate } = decodeRawAudio(msg);
    expect(channels).toHaveLength(2);
    expect(Array.from(channels[0]!)).toEqual([1, 2]);
    expect(Array.from(channels[1]!)).toEqual([-32768, -32768]);
    expect(sampleRate).toBe(48000);
  });

  it("dispatches g711-alaw to the den decoder with known ITU-T vectors", () => {
    const { channels, sampleRate } = decodeRawAudio(
      rawAudio({
        format: "g711-alaw",
        sample_rate: 8000,
        // 0xd5 -> +8, 0x55 -> -8, 0xaa -> +32256 (full scale)
        data: Uint8Array.from([0xd5, 0x55, 0xaa]),
      }),
    );
    expect(Array.from(channels[0]!)).toEqual([8, -8, 32256]);
    expect(sampleRate).toBe(8000);
  });

  it("dispatches g711-ulaw to the den decoder with known ITU-T vectors", () => {
    const { channels } = decodeRawAudio(
      rawAudio({
        format: "g711-ulaw",
        // 0xff -> 0, 0x7f -> 0 (negative zero), 0x00 -> -32124, 0x80 -> +32124 (full scale)
        data: Uint8Array.from([0xff, 0x7f, 0x00, 0x80]),
      }),
    );
    expect(Array.from(channels[0]!)).toEqual([0, 0, -32124, 32124]);
  });

  it("deinterleaves g711 samples across channels", () => {
    const { channels } = decodeRawAudio(
      rawAudio({ format: "g711-alaw", number_of_channels: 2, data: Uint8Array.from([0xd5, 0x55]) }),
    );
    expect(channels).toHaveLength(2);
    expect(Array.from(channels[0]!)).toEqual([8]);
    expect(Array.from(channels[1]!)).toEqual([-8]);
  });

  it("throws for formats with no decode path instead of falling back silently", () => {
    expect(() => decodeRawAudio(rawAudio({ format: "g726-40" }))).toThrow(/unsupported/i);
    expect(() => decodeRawAudio(rawAudio({ format: "aal2-g726-40" }))).toThrow(/unsupported/i);
  });

  it("drops a trailing partial pcm-s16 sample", () => {
    const { channels } = decodeRawAudio(rawAudio({ data: Uint8Array.from([0x01, 0x00, 0x02]) }));
    expect(Array.from(channels[0]!)).toEqual([1]);
  });
});

class FakeAudioData {
  public numberOfFrames: number;
  public numberOfChannels: number;
  public format = "s16";
  public closed = false;

  public constructor(frames: number) {
    this.numberOfFrames = frames;
    this.numberOfChannels = 2;
  }

  public copyTo(destination: Int16Array): void {
    for (let i = 0; i < destination.length; i++) {
      destination[i] = (i % 2 === 0 ? 1 : -1) * 1000;
    }
  }

  public close(): void {
    this.closed = true;
  }
}

class FakeAudioDecoder {
  public static last: FakeAudioDecoder | undefined;
  public static chunks: unknown[] = [];
  public state = "unconfigured";
  public config: unknown;
  public decodeCount = 0;

  public constructor(
    private init: { output: (data: FakeAudioData) => void; error: (error: unknown) => void },
  ) {
    FakeAudioDecoder.last = this;
  }

  public configure(config: unknown): void {
    this.config = config;
    this.state = "configured";
  }

  public decode(chunk: unknown): void {
    FakeAudioDecoder.chunks.push(chunk);
    this.decodeCount++;
    this.init.output(new FakeAudioData(4));
  }

  public async flush(): Promise<void> {}

  public close(): void {
    this.state = "closed";
  }
}

describe("CompressedAudioDecoder", () => {
  beforeEach(() => {
    (globalThis as { AudioDecoder?: unknown }).AudioDecoder = FakeAudioDecoder;
    delete (globalThis as { EncodedAudioChunk?: unknown }).EncodedAudioChunk;
    FakeAudioDecoder.last = undefined;
    FakeAudioDecoder.chunks = [];
  });

  afterEach(() => {
    delete (globalThis as { AudioDecoder?: unknown }).AudioDecoder;
  });

  const opusMsg: CompressedAudioLike = {
    timestamp: { sec: 1, nsec: 500_000_000 },
    format: "opus",
    data: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
  };

  it("emits PCM frames via a mocked global AudioDecoder", async () => {
    const frames: AudioFrame[] = [];
    const decoder = new CompressedAudioDecoder("opus", (frame) => frames.push(frame));
    await decoder.decode(opusMsg);

    expect(FakeAudioDecoder.last?.state).toBe("configured");
    expect(FakeAudioDecoder.last?.config).toMatchObject({ codec: "opus" });
    expect(FakeAudioDecoder.last?.decodeCount).toBe(1);
    // Timestamp is converted to microseconds as WebCodecs expects.
    expect(FakeAudioDecoder.chunks[0]).toMatchObject({ timestamp: 1_500_000, data: opusMsg.data });

    expect(frames).toHaveLength(1);
    expect(frames[0]!.data).toBeInstanceOf(Int16Array);
    expect(frames[0]!.data).toHaveLength(8); // 4 frames * 2 channels
    expect(frames[0]!.sampleCount).toBe(4);

    decoder.dispose();
    expect(FakeAudioDecoder.last?.state).toBe("closed");
  });

  it("configures the AAC codec string for mp4a.40.2", async () => {
    const decoder = new CompressedAudioDecoder("mp4a.40.2", () => {});
    await decoder.decode({ ...opusMsg, format: "mp4a.40.2" });
    expect(FakeAudioDecoder.last?.config).toMatchObject({ codec: "mp4a.40.2" });
    decoder.dispose();
  });

  it("rejects cleanly when AudioDecoder is absent", async () => {
    delete (globalThis as { AudioDecoder?: unknown }).AudioDecoder;
    const decoder = new CompressedAudioDecoder("opus", () => {});
    await expect(decoder.decode(opusMsg)).rejects.toThrow(/unsupported/i);
  });
});

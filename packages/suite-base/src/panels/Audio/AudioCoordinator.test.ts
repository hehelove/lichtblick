// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { AudioCoordinator, CoordinatorBuffer, PcmChunk } from "./AudioCoordinator";

function makeFakeContext() {
  const sources: {
    buffer: unknown;
    playbackRate: { value: number };
    connect: ReturnType<typeof jest.fn>;
    start: ReturnType<typeof jest.fn>;
    stop: ReturnType<typeof jest.fn>;
    onended: (() => void) | null;
  }[] = [];
  const gain = { gain: { value: 1 }, connect: jest.fn() };
  const createdBuffers: unknown[] = [];
  const ctx = {
    currentTime: 0,
    state: "running",
    destination: {},
    createGain: () => gain,
    resume: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    createBuffer: (channelCount: number, length: number, sampleRate: number) => {
      const buffer = { channelCount, length, sampleRate, copyToChannel: jest.fn() };
      createdBuffers.push(buffer);
      return buffer;
    },
    createBufferSource: () => {
      const source = {
        buffer: undefined,
        playbackRate: { value: 1 },
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        onended: null,
      };
      sources.push(source);
      return source;
    },
  };
  return { ctx, gain, sources, createdBuffers };
}

function pcmChunk(length = 8000): PcmChunk {
  return { channels: [new Int16Array(length)], sampleRate: 8000 };
}

const chunkA = pcmChunk(); // 1s of audio
const chunkB = pcmChunk();
const buffers: CoordinatorBuffer[] = [
  { startSec: 0, durationSec: 1, buffer: chunkA },
  { startSec: 100, durationSec: 1, buffer: chunkB },
];

describe("AudioCoordinator", () => {
  it("schedules only buffers overlapping the playhead window, with seek offsets", () => {
    const { ctx, sources, createdBuffers } = makeFakeContext();
    const coordinator = new AudioCoordinator({ audioContextFactory: () => ctx as unknown as AudioContext });
    coordinator.setBuffers(buffers);
    coordinator.sync({ currentTime: { sec: 0, nsec: 500_000_000 }, isPlaying: true, speed: 1 });

    expect(sources).toHaveLength(1);
    expect(createdBuffers).toHaveLength(1);
    expect(sources[0]!.buffer).toBe(createdBuffers[0]);
    expect(sources[0]!.start).toHaveBeenCalledWith(0, 0.5);
    expect(sources[0]!.playbackRate.value).toBe(1);
    coordinator.dispose();
  });

  it("stops sources when playback pauses", () => {
    const { ctx, sources } = makeFakeContext();
    const coordinator = new AudioCoordinator({ audioContextFactory: () => ctx as unknown as AudioContext });
    coordinator.setBuffers(buffers);
    coordinator.sync({ currentTime: { sec: 0, nsec: 0 }, isPlaying: true, speed: 1 });
    expect(sources[0]!.stop).not.toHaveBeenCalled();

    coordinator.sync({ currentTime: { sec: 0, nsec: 0 }, isPlaying: false, speed: 1 });
    expect(sources[0]!.stop).toHaveBeenCalled();
    coordinator.dispose();
  });

  it("reschedules on a seek discontinuity", () => {
    const { ctx, sources } = makeFakeContext();
    const coordinator = new AudioCoordinator({ audioContextFactory: () => ctx as unknown as AudioContext });
    coordinator.setBuffers(buffers);
    coordinator.sync({ currentTime: { sec: 0, nsec: 0 }, isPlaying: true, speed: 1 });
    expect(sources).toHaveLength(1);

    // Jump far ahead with (near-)zero wall time elapsed -> discontinuity.
    coordinator.sync({ currentTime: { sec: 50, nsec: 0 }, isPlaying: true, speed: 1 });
    expect(sources[0]!.stop).toHaveBeenCalled();
    expect(sources).toHaveLength(1); // only the stopped one; nothing overlaps 50s
    coordinator.dispose();
  });

  it("applies volume through the gain node and closes the context on dispose", () => {
    const { ctx, gain } = makeFakeContext();
    const coordinator = new AudioCoordinator({ audioContextFactory: () => ctx as unknown as AudioContext });
    coordinator.setVolume(0.5);
    coordinator.sync({ currentTime: { sec: 0, nsec: 0 }, isPlaying: true, speed: 1 });
    expect(gain.gain.value).toBe(0.5);

    coordinator.dispose();
    expect(ctx.close).toHaveBeenCalled();
  });
});

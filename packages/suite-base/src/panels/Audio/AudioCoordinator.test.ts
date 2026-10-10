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
  { startSec: 200, durationSec: 1, buffer: chunkB }, // beyond the schedule-ahead window
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

  it("schedules the full panel supply window so continuous playback never runs into silence", () => {
    // Regression: sync() only reschedules on discontinuities, so a schedule-ahead window smaller
    // than the panel's supply window ([playhead-5, playhead+120]) left the second minute of audio
    // unqueued and playback went silent on/off in 30s duty cycles.
    const { ctx, sources } = makeFakeContext();
    const nowSpy = jest.spyOn(performance, "now").mockReturnValue(0);
    const coordinator = new AudioCoordinator({ audioContextFactory: () => ctx as unknown as AudioContext });
    const supply: CoordinatorBuffer[] = [
      { startSec: 0, durationSec: 1, buffer: chunkA },
      { startSec: 100, durationSec: 1, buffer: pcmChunk() },
    ];
    coordinator.setBuffers(supply);
    coordinator.sync({ currentTime: { sec: 0, nsec: 0 }, isPlaying: true, speed: 1 });
    expect(sources).toHaveLength(2); // both chunks within the window are queued up front

    // 35s of continuous playback (wall clock tracks playhead): no discontinuity, no reschedule —
    // the 100s chunk must already be scheduled, or audio stops at the 30s mark.
    nowSpy.mockReturnValue(35_000);
    coordinator.sync({ currentTime: { sec: 35, nsec: 0 }, isPlaying: true, speed: 1 });
    expect(sources.filter((source) => source.start.mock.calls.length === 0)).toHaveLength(0);
    expect(sources.every((source) => source.stop.mock.calls.length === 0)).toBe(true);
    nowSpy.mockRestore();
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

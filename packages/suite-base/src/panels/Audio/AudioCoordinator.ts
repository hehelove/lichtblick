// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@lichtblick/suite";

/** Plain PCM payload handed to the coordinator; the panel never touches AudioContext directly. */
export type PcmChunk = {
  channels: Int16Array[];
  sampleRate: number;
};

export type CoordinatorBuffer = {
  /** Playback-time position of the buffer start, in seconds. */
  startSec: number;
  durationSec: number;
  buffer: unknown;
};

export type CoordinatorSyncState = {
  currentTime: Time | undefined;
  isPlaying: boolean;
  speed: number;
};

/**
 * How far ahead of the playhead buffers are scheduled. Must cover the panel's supply window
 * (PLAYBACK_AHEAD_SEC + margin): sync() only reschedules on discontinuities, so continuous
 * playback relies on the initial setBuffers() having scheduled everything up ahead.
 */
const SCHEDULE_AHEAD_SEC = 130;
/** Playhead drift (seconds) beyond which a seek discontinuity is assumed. */
const SEEK_THRESHOLD_SEC = 0.05;

function toSec(time: Time): number {
  return time.sec + time.nsec * 1e-9;
}

/**
 * Schedules decoded PCM buffers onto an AudioContext so they track the player's playhead.
 *
 * Standalone class (not a hook) on purpose: panel tests mock it at the module boundary and run
 * in jsdom without AudioContext. Every discontinuity (seek, play/pause, speed change) stops all
 * sources and reschedules from the new playhead — no incremental patching.
 */
export class AudioCoordinator {
  private ctx: AudioContext | undefined;
  private gain: GainNode | undefined;
  private readonly factory: () => AudioContext | undefined;
  private buffers: CoordinatorBuffer[] = [];
  private readonly audioBuffers = new WeakMap<object, AudioBuffer>();
  private readonly sources = new Set<AudioBufferSourceNode>();
  private volume = 1;
  private state: CoordinatorSyncState = { currentTime: undefined, isPlaying: false, speed: 1 };
  private lastSyncWallMs: number | undefined;
  private lastPlayheadSec: number | undefined;

  public constructor(args?: { audioContextFactory?: () => AudioContext }) {
    this.factory =
      args?.audioContextFactory ??
      (() => (typeof AudioContext !== "undefined" ? new AudioContext() : undefined));
  }

  private ensureContext(): AudioContext | undefined {
    if (this.ctx != undefined) {
      return this.ctx;
    }
    this.ctx = this.factory();
    if (this.ctx != undefined) {
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  public setBuffers(buffers: CoordinatorBuffer[]): void {
    this.buffers = [...buffers].sort((a, b) => a.startSec - b.startSec);
    this.reschedule();
  }

  /** Resumes a context suspended by the browser autoplay policy (call from a user gesture). */
  public async resume(): Promise<void> {
    await this.ensureContext()?.resume();
  }

  public sync(state: CoordinatorSyncState): void {
    const playheadSec = state.currentTime != undefined ? toSec(state.currentTime) : undefined;
    let discontinuous =
      state.isPlaying !== this.state.isPlaying || state.speed !== this.state.speed;

    if (playheadSec != undefined && this.lastPlayheadSec != undefined && this.lastSyncWallMs != undefined) {
      const wallElapsedSec = (performance.now() - this.lastSyncWallMs) / 1000;
      const expected =
        this.state.isPlaying ? this.lastPlayheadSec + wallElapsedSec * this.state.speed : this.lastPlayheadSec;
      if (Math.abs(playheadSec - expected) > SEEK_THRESHOLD_SEC) {
        discontinuous = true;
      }
    }

    this.state = state;
    this.lastPlayheadSec = playheadSec;
    this.lastSyncWallMs = performance.now();
    if (discontinuous) {
      this.reschedule();
    }
  }

  public setVolume(volume: number): void {
    this.volume = volume;
    if (this.gain != undefined) {
      this.gain.gain.value = volume;
    }
  }

  private getOrCreateAudioBuffer(ctx: AudioContext, entry: CoordinatorBuffer): AudioBuffer | undefined {
    const pcm = entry.buffer as PcmChunk | undefined;
    if (pcm?.channels == undefined || pcm.channels.length === 0 || pcm.sampleRate <= 0) {
      return undefined;
    }
    const cached = this.audioBuffers.get(pcm);
    if (cached != undefined) {
      return cached;
    }
    const length = pcm.channels[0]!.length;
    const audioBuffer = ctx.createBuffer(pcm.channels.length, length, pcm.sampleRate);
    pcm.channels.forEach((channel, index) => {
      // WebAudio buffers are float32; convert the int16 PCM once per buffer.
      const floats = new Float32Array(channel.length);
      for (let i = 0; i < channel.length; i++) {
        floats[i] = channel[i]! / 32768;
      }
      audioBuffer.copyToChannel(floats, index);
    });
    this.audioBuffers.set(pcm, audioBuffer);
    return audioBuffer;
  }

  private reschedule(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped or not started.
      }
      this.sources.delete(source);
    }

    const ctx = this.ensureContext();
    if (ctx == undefined || !this.state.isPlaying || this.state.speed <= 0) {
      return;
    }
    if (this.gain == undefined || (this.ctx?.state ?? "running") === "suspended") {
      return;
    }
    const playheadSec = this.state.currentTime != undefined ? toSec(this.state.currentTime) : undefined;
    if (playheadSec == undefined) {
      return;
    }

    for (const entry of this.buffers) {
      const endSec = entry.startSec + entry.durationSec;
      if (endSec <= playheadSec || entry.startSec > playheadSec + SCHEDULE_AHEAD_SEC) {
        continue;
      }
      const audioBuffer = this.getOrCreateAudioBuffer(ctx, entry);
      if (audioBuffer == undefined) {
        continue;
      }
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = this.state.speed;
      source.connect(this.gain);
      const when = ctx.currentTime + Math.max(0, entry.startSec - playheadSec) / this.state.speed;
      const offset = Math.max(0, playheadSec - entry.startSec);
      source.start(when, offset);
      source.onended = () => {
        this.sources.delete(source);
      };
      this.sources.add(source);
    }
  }

  public dispose(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped or not started.
      }
    }
    this.sources.clear();
    this.buffers = [];
    void this.ctx?.close();
    this.ctx = undefined;
    this.gain = undefined;
  }
}

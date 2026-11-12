// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Button } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  canonicalAudioFormat,
  isCompressedAudioFormat,
} from "@lichtblick/den/audio";
import { MessageEvent, SettingsTreeAction, Time } from "@lichtblick/suite";
import {
  useDataSourceInfo,
  useMessagesByTopic,
} from "@lichtblick/suite-base/PanelAPI";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Panel from "@lichtblick/suite-base/components/Panel";
import { useSubscribeMessageRange } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import Stack from "@lichtblick/suite-base/components/Stack";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

import { AudioCoordinator, CoordinatorBuffer } from "./AudioCoordinator";
import {
  CompressedAudioDecoder,
  DecodedAudio,
  decodeRawAudio,
} from "./decoding";
import { buildSettingsTree } from "./settings";
import {
  AudioConfig,
  CompressedAudioLike,
  RawAudioLike,
  SUPPORTED_DATATYPES,
} from "./types";

type Props = {
  config: AudioConfig;
  saveConfig: SaveConfig<AudioConfig>;
};

type AudioMessageEvent =
  MessageEvent<RawAudioLike> | MessageEvent<CompressedAudioLike>;

type DecodedEntry = {
  key: string;
  timestamp: Time;
  decoded?: DecodedAudio;
};

type CompressedEntry = {
  decoder: CompressedAudioDecoder;
  samples: number[];
  sampleRate?: number;
};

type CompressedStore = {
  decoders: Map<string, CompressedEntry>;
  pending: Map<string, DecodedAudio>;
  failed: Set<string>;
};

function makeCompressedStore(): CompressedStore {
  return { decoders: new Map(), pending: new Map(), failed: new Set() };
}

const DEFAULT_VOLUME = 0.5;
// ponytail: decode cache cap with oldest-first eviction keeps long recordings from piling every
// decoded chunk on the heap; raise it (or evict by distance from the playhead) if thrashing.
const MAX_DECODE_CACHE = 4000;
// Playback buffers are loaded for a window around the playhead and reloaded only when the
// playhead drifts out of the inner half, so ticking currentTime does not reschedule audio.
const PLAYBACK_BEHIND_SEC = 5;
const PLAYBACK_AHEAD_SEC = 120;

const EMPTY_TOPICS: string[] = [];

const selectCurrentTime = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.currentTime;
const selectIsPlaying = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.isPlaying ?? false;
const selectSpeed = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.speed ?? 1;

function toSec(time: Time): number {
  return time.sec + time.nsec * 1e-9;
}

function fromSec(sec: number): Time {
  const whole = Math.floor(sec);
  return { sec: whole, nsec: Math.round((sec - whole) * 1e9) };
}

function messageKey(msgEvent: AudioMessageEvent): string {
  return `${msgEvent.topic}|${msgEvent.receiveTime.sec}|${msgEvent.receiveTime.nsec}`;
}

const WAVEFORM_COLOR = "#4fc3f7";

const AudioPanel = React.memo(({ config, saveConfig }: Props) => {
  const { t } = useTranslation("audio");
  const { topics } = useDataSourceInfo();
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();

  const volume = config.volume ?? DEFAULT_VOLUME;

  const availableTopics = useMemo(
    () =>
      topics.filter(
        (topic) =>
          topic.schemaName != undefined &&
          SUPPORTED_DATATYPES.has(topic.schemaName),
      ),
    [topics],
  );
  const topicName = config.topicToRender ?? availableTopics[0]?.name;

  // Full history when the source supports batch iteration; stays undefined (live fallback)
  // when onNewRangeIterator never fires.
  const subscribeMessageRange = useSubscribeMessageRange();
  const [rangeMessages, setRangeMessages] = useState<
    AudioMessageEvent[] | undefined
  >();

  // Live rolling window: the only source for live connections where the player cannot serve
  // batch iterators. Unsubscribes once batch mode supplies the full history, so the pipeline
  // doesn't keep a second rolling buffer of parsed messages alive.
  const liveByTopic = useMessagesByTopic({
    topics:
      topicName != undefined && rangeMessages == undefined
        ? [topicName]
        : EMPTY_TOPICS,
    historySize: 100000,
  }) as { [topic: string]: AudioMessageEvent[] };
  useEffect(() => {
    if (topicName == undefined) {
      return;
    }
    let cancelled: boolean = false;
    const accumulated: AudioMessageEvent[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      flushTimer = undefined;
      if (!cancelled) {
        setRangeMessages([...accumulated]);
      }
    };
    const cancel = subscribeMessageRange({
      topic: topicName,
      onNewRangeIterator: async (iterator) => {
        setRangeMessages([]); // Batch mode is active; supersede the rolling window.
        for await (const batch of iterator) {
          if (cancelled) {
            return;
          }
          accumulated.push(...(batch as AudioMessageEvent[]));
          flushTimer ??= setTimeout(flush, 250);
        }
        if (flushTimer != undefined) {
          clearTimeout(flushTimer);
        }
        flush();
      },
    });
    return () => {
      cancelled = true;
      if (flushTimer != undefined) {
        clearTimeout(flushTimer);
      }
      cancel();
      // Don't keep rendering the previous topic's waveform if the new topic's iterator never
      // fires (e.g. a live source).
      setRangeMessages(undefined);
    };
  }, [topicName, subscribeMessageRange]);

  const messages = useMemo(
    () =>
      rangeMessages ??
      (topicName != undefined ? (liveByTopic[topicName] ?? []) : []),
    [rangeMessages, liveByTopic, topicName],
  );

  // Compressed (opus/AAC) messages decode asynchronously through WebCodecs into the same
  // DecodedAudio shape as the raw path. Decoders and failures live in a ref; completed decodes
  // are mirrored into state so dependent memos recompute.
  // ponytail: decodes every compressed message in the recording; window it if that ever matters.
  const compressedRef = useRef<CompressedStore>(makeCompressedStore());
  const [compressedPcm, setCompressedPcm] = useState(
    () => new Map<string, DecodedAudio>(),
  );

  useEffect(() => {
    let cancelled: boolean = false;
    let lastEmitMs = performance.now();
    const run = async () => {
      const store = compressedRef.current;
      for (const msgEvent of messages) {
        if (cancelled) {
          return;
        }
        const format = canonicalAudioFormat(msgEvent.message.format);
        if (format !== "opus" && format !== "mp4a.40.2") {
          continue;
        }
        const key = messageKey(msgEvent);
        if (store.pending.has(key) || store.failed.has(key)) {
          continue;
        }
        let entry = store.decoders.get(format);
        if (entry == undefined) {
          const entryInit: CompressedEntry = {
            samples: [],
            sampleRate: undefined,
            decoder: new CompressedAudioDecoder(format, (frame) => {
              for (const sample of frame.data) {
                entryInit.samples.push(sample);
              }
              entryInit.sampleRate ??= frame.sampleRate;
            }),
          };
          entry = entryInit;
          store.decoders.set(format, entry);
        }
        const startLength = entry.samples.length;
        try {
          await entry.decoder.decode(msgEvent.message);
        } catch {
          // Host without WebCodecs or a decoder error: no waveform/playback for this chunk.
          store.failed.add(key);
          continue;
        }
        store.pending.set(key, {
          channels: [Int16Array.from(entry.samples.slice(startLength))],
          sampleRate: entry.sampleRate ?? 48000,
        });
        // This chunk's frames are flushed into `pending`; drop them from the accumulator so it
        // doesn't grow with the whole recording.
        entry.samples.length = 0;
        while (store.pending.size > MAX_DECODE_CACHE) {
          const oldest = store.pending.keys().next().value;
          if (oldest == undefined) {
            break;
          }
          store.pending.delete(oldest);
        }
        // Throttle state updates: each one recomputes the decode memo and rescans every sample
        // for the canvas, so per-chunk emission is quadratic on long recordings.
        if (performance.now() - lastEmitMs >= 250) {
          lastEmitMs = performance.now();
          setCompressedPcm(new Map(store.pending));
        }
      }
      if (!cancelled && store.pending.size > 0) {
        setCompressedPcm(new Map(store.pending));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [messages]);

  // Raw decode pass: cache keyed by topic+receiveTime so re-renders never re-decode.
  const decodeCacheRef = useRef(new Map<string, DecodedAudio>());
  const decoded = useMemo(() => {
    const cache = decodeCacheRef.current;
    const entries: DecodedEntry[] = [];
    const unsupported = new Set<string>();
    for (const msgEvent of messages) {
      const raw = msgEvent.message;
      const key = messageKey(msgEvent);
      const format = canonicalAudioFormat(raw.format);
      if (format == undefined) {
        // e.g. g726-*, aal2-*: explicit unsupported, never silent.
        unsupported.add(raw.format);
        continue;
      }
      if (isCompressedAudioFormat(format)) {
        const pcm = compressedPcm.get(key);
        if (pcm != undefined) {
          entries.push({ key, timestamp: raw.timestamp, decoded: pcm });
        }
        continue;
      }
      let pcm = cache.get(key);
      if (pcm == undefined) {
        pcm = decodeRawAudio(raw as RawAudioLike);
        cache.set(key, pcm);
      }
      entries.push({ key, timestamp: raw.timestamp, decoded: pcm });
    }
    while (cache.size > MAX_DECODE_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest == undefined) {
        break;
      }
      cache.delete(oldest);
    }
    return { entries, unsupported };
  }, [messages, compressedPcm]);

  // Waveform envelope (min/max per pixel column) drawn on a canvas.
  const canvasRef = useRef<HTMLCanvasElement | ReactNull>(ReactNull);
  const seekRange = useMemo(() => {
    let startSec = Number.POSITIVE_INFINITY;
    let endSec = Number.NEGATIVE_INFINITY;
    let start: Time = { sec: 0, nsec: 0 };
    for (const entry of decoded.entries) {
      const entryStartSec = toSec(entry.timestamp);
      const channel = entry.decoded?.channels[0];
      const durationSec =
        channel != undefined && entry.decoded!.sampleRate > 0
          ? channel.length / entry.decoded!.sampleRate
          : 0;
      if (entryStartSec < startSec) {
        startSec = entryStartSec;
        start = entry.timestamp;
      }
      endSec = Math.max(endSec, entryStartSec + durationSec);
    }
    if (!Number.isFinite(startSec)) {
      return { start: { sec: 0, nsec: 0 }, startSec: 0, endSec: 0 };
    }
    return { start, startSec, endSec };
  }, [decoded]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas == undefined) {
      return;
    }
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx == undefined) {
      return;
    }
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);

    const spanSec = seekRange.endSec - seekRange.startSec;
    if (spanSec <= 0 || decoded.entries.length === 0) {
      return;
    }
    const mins = new Float32Array(width).fill(1);
    const maxs = new Float32Array(width).fill(-1);
    const mid = height / 2;
    for (const entry of decoded.entries) {
      const channel = entry.decoded?.channels[0];
      if (channel == undefined) {
        continue;
      }
      const entryStartSec = toSec(entry.timestamp);
      const durationSec = channel.length / entry.decoded!.sampleRate;
      const colA = Math.floor(
        ((entryStartSec - seekRange.startSec) / spanSec) * width,
      );
      const colB = Math.ceil(
        ((entryStartSec + durationSec - seekRange.startSec) / spanSec) * width,
      );
      const colSpan = Math.max(1, colB - colA);
      for (let i = 0; i < channel.length; i++) {
        const col = colA + Math.floor((colSpan * i) / channel.length);
        if (col < 0 || col >= width) {
          continue;
        }
        const sample = channel[i]! / 32768;
        if (sample < mins[col]!) {
          mins[col] = sample;
        }
        if (sample > maxs[col]!) {
          maxs[col] = sample;
        }
      }
    }
    ctx.fillStyle = WAVEFORM_COLOR;
    for (let col = 0; col < width; col++) {
      const min = mins[col]!;
      const max = maxs[col]!;
      if (min > max) {
        continue;
      }
      const y1 = mid - max * mid;
      const y2 = mid - min * mid;
      ctx.fillRect(col, y1, 1, Math.max(1, y2 - y1));
    }
  }, [decoded, seekRange]);

  // Click-to-seek (same pattern as the Log panel's stamp seek).
  const getMessagePipeline = useMessagePipelineGetter();
  const onWaveformClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const spanSec = seekRange.endSec - seekRange.startSec;
      const fraction =
        rect.width > 0 && spanSec > 0
          ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
          : 0;
      getMessagePipeline().seekPlayback?.(
        fromSec(seekRange.startSec + fraction * spanSec),
      );
    },
    [getMessagePipeline, seekRange],
  );

  // Playback coordination. The panel never touches AudioContext directly; the coordinator is a
  // module boundary that tests mock. Audio is constructed only from the enable user gesture so
  // the browser autoplay policy is respected.
  const currentTime = useMessagePipeline(selectCurrentTime);
  const isPlaying = useMessagePipeline(selectIsPlaying);
  const speed = useMessagePipeline(selectSpeed);

  const coordinatorRef = useRef<AudioCoordinator | undefined>(undefined);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const enableAudio = useCallback(() => {
    coordinatorRef.current ??= new AudioCoordinator();
    void coordinatorRef.current.resume();
    setAudioEnabled(true);
  }, []);

  useEffect(() => {
    coordinatorRef.current?.sync({ currentTime, isPlaying, speed });
  }, [currentTime, isPlaying, speed, audioEnabled]);

  useEffect(() => {
    coordinatorRef.current?.setVolume(volume);
  }, [volume, audioEnabled]);

  // Load a playhead-centered window of decoded chunks; skip work while the playhead stays in the
  // inner half of the loaded window so playback ticks do not reschedule sources.
  const loadedWindowRef = useRef<
    { centerSec: number; decoded: unknown } | undefined
  >();
  useEffect(() => {
    const coordinator = coordinatorRef.current;
    if (coordinator == undefined) {
      return;
    }
    const playheadSec = currentTime != undefined ? toSec(currentTime) : 0;
    const loaded = loadedWindowRef.current;
    const drifted =
      loaded == undefined ||
      Math.abs(playheadSec - loaded.centerSec) > PLAYBACK_AHEAD_SEC / 2;
    if (loaded?.decoded === decoded && !drifted) {
      return;
    }
    loadedWindowRef.current = { centerSec: playheadSec, decoded };

    const buffers: CoordinatorBuffer[] = [];
    for (const entry of decoded.entries) {
      const channel = entry.decoded?.channels[0];
      if (channel == undefined || entry.decoded!.sampleRate <= 0) {
        continue;
      }
      const startSec = toSec(entry.timestamp);
      const durationSec = channel.length / entry.decoded!.sampleRate;
      if (startSec + durationSec < playheadSec - PLAYBACK_BEHIND_SEC) {
        continue;
      }
      if (startSec > playheadSec + PLAYBACK_AHEAD_SEC) {
        continue;
      }
      buffers.push({ startSec, durationSec, buffer: entry.decoded });
    }
    coordinator.setBuffers(buffers);
  }, [audioEnabled, decoded, currentTime]);

  useEffect(() => {
    const coordinator = coordinatorRef.current;
    const store = compressedRef.current;
    return () => {
      coordinator?.dispose();
      for (const entry of store.decoders.values()) {
        entry.decoder.dispose();
      }
    };
  }, []);

  // Settings tree (Log panel pattern).
  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action !== "update") {
        return;
      }
      const { path, value } = action.payload;
      const field = path[1];
      if (field === "topicToRender") {
        saveConfig((prevConfig) => ({
          ...prevConfig,
          topicToRender: String(value),
        }));
      } else if (field === "volume") {
        saveConfig((prevConfig) => ({ ...prevConfig, volume: Number(value) }));
      }
    },
    [saveConfig],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      enableFilter: true,
      nodes:
        topicName != undefined
          ? buildSettingsTree(topicName, volume, availableTopics, t)
          : {},
    });
  }, [
    actionHandler,
    availableTopics,
    topicName,
    volume,
    updatePanelSettingsTree,
    t,
  ]);

  return (
    <Stack
      fullHeight
      data-testid="audio-panel-root"
      style={{ position: "relative" }}
    >
      <PanelToolbar />
      {topicName == undefined ? (
        <Stack flexGrow={1} alignItems="center" justifyContent="center">
          {t("noAudioTopics")}
        </Stack>
      ) : (
        <>
          {decoded.unsupported.size > 0 && (
            <Stack padding={0.5}>
              {[...decoded.unsupported].map((format) => (
                <div key={format}>{t("unsupportedFormat", { format })}</div>
              ))}
            </Stack>
          )}
          <Stack flexGrow={1} position="relative">
            <canvas
              ref={canvasRef}
              data-testid="audio-waveform"
              style={{
                width: "100%",
                height: "100%",
                display: "block",
                cursor: "crosshair",
              }}
              onClick={onWaveformClick}
            />
          </Stack>
          {!audioEnabled && (
            <Button
              variant="contained"
              onClick={enableAudio}
              style={{ position: "absolute", bottom: 8, right: 8 }}
            >
              {t("enableAudio")}
            </Button>
          )}
        </>
      )}
    </Stack>
  );
});

AudioPanel.displayName = "Audio";

export default Panel(
  Object.assign(AudioPanel, {
    defaultConfig: { volume: DEFAULT_VOLUME },
    panelType: "Audio",
  }),
);

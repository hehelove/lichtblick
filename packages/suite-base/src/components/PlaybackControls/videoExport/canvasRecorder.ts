// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4;codecs=avc1",
] as const;

/**
 * Feature-detect a MediaRecorder mimeType for canvas capture. Returns undefined when
 * MediaRecorder is unavailable (jsdom, old browsers) so callers can disable export.
 */
export function pickVideoMimeType(): string | undefined {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return undefined;
  }
  for (const mimeType of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return undefined;
}

export type CanvasRecorder = {
  start: () => void;
  stop: () => Promise<{ blob: Blob; mimeType: string }>;
};

/**
 * Record an HTMLCanvasElement with MediaRecorder over canvas.captureStream(fps).
 *
 * NOTE: MediaRecorder timestamps frames with the wall clock, so recording runs in
 * real time — callers must force 1x playback during the export. Deterministic or
 * faster-than-realtime export would need WebCodecs + a muxer (out of scope).
 */
export function createCanvasRecorder(
  canvas: HTMLCanvasElement,
  opts: { fps: number; mimeType: string },
): CanvasRecorder {
  // captureStream is not in the TS DOM lib and is missing under jsdom
  const captureStream = (
    canvas as HTMLCanvasElement & {
      captureStream?: (frameRequestRate: number) => MediaStream;
    }
  ).captureStream;
  if (typeof captureStream !== "function") {
    throw new Error(
      "Canvas capture (captureStream) is not supported in this browser",
    );
  }
  const stream = captureStream.call(canvas, opts.fps);
  const recorder = new MediaRecorder(stream, { mimeType: opts.mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };
  let started = false;
  return {
    start() {
      if (!started) {
        started = true;
        recorder.start();
      }
    },
    async stop() {
      return await new Promise<{ blob: Blob; mimeType: string }>(
        (resolve, reject) => {
          if (!started) {
            // export was stopped before recording began (e.g. while waiting for the seek)
            resolve({
              blob: new Blob(chunks, { type: opts.mimeType }),
              mimeType: opts.mimeType,
            });
            return;
          }
          recorder.onstop = () => {
            resolve({
              blob: new Blob(chunks, { type: opts.mimeType }),
              mimeType: opts.mimeType,
            });
          };
          recorder.onerror = (_event: Event) => {
            reject(new Error("MediaRecorder failed during video export"));
          };
          recorder.stop();
        },
      );
    },
  };
}

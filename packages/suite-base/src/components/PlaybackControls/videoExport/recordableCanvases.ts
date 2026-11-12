// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { useSyncExternalStore } from "react";

export type RecordableCanvas = {
  id: string;
  canvas: HTMLCanvasElement;
  title: string;
};

/**
 * Module-level registry of canvases that can be recorded for video export
 * (3D and Image panels register themselves; Plot renders offscreen and cannot).
 * Module state keeps the registry usable from the PlaybackControls toolbar and
 * panel components without provider threading.
 */
const entries = new Map<string, RecordableCanvas>();
const listeners = new Set<() => void>();
// cached snapshot so useSyncExternalStore sees a stable reference
let snapshot: RecordableCanvas[] = [];

function emitChange(): void {
  snapshot = Array.from(entries.values());
  for (const listener of listeners) {
    listener();
  }
}

export function registerRecordableCanvas(
  id: string,
  entry: { canvas: HTMLCanvasElement; title: string },
): () => void {
  const record = { id, ...entry };
  entries.set(id, record);
  emitChange();
  return () => {
    // only unregister when this registration is still the current one
    if (entries.get(id) === record) {
      entries.delete(id);
      emitChange();
    }
  };
}

export function getRecordableCanvases(): RecordableCanvas[] {
  return snapshot;
}

export function subscribeRecordableCanvases(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRecordableCanvases(): RecordableCanvas[] {
  return useSyncExternalStore(
    subscribeRecordableCanvases,
    getRecordableCanvases,
  );
}

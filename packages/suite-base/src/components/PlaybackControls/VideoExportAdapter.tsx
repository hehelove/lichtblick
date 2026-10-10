// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import {
  Dispatch,
  SetStateAction,
  useEffect,
  useLayoutEffect,
  useSyncExternalStore,
} from "react";

import { Time, compare } from "@lichtblick/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { downloadFiles } from "@lichtblick/suite-base/util/download";
import sendNotification from "@lichtblick/suite-base/util/sendNotification";

import { CanvasRecorder } from "./videoExport/canvasRecorder";
import {
  getRecordableCanvases,
  subscribeRecordableCanvases,
} from "./videoExport/recordableCanvases";

export type VideoExportSession = {
  canvasId: string;
  title: string;
  fps: number;
  mimeType: string;
  startTime: Time;
  endTime: Time;
  recorder: CanvasRecorder;
  restoreSpeed: number | undefined;
  restoreRepeat: boolean;
  phase: "arming" | "recording" | "stopping";
};

// Module-level session state so the adapter, dialog and toolbar button stay in sync
// without extra prop threading through PlaybackControls (dialog props stay { onClose }).
let activeSession: VideoExportSession | undefined;
const sessionListeners = new Set<() => void>();

function getActiveVideoExportSession(): VideoExportSession | undefined {
  return activeSession;
}

function emitSessionChange(): void {
  for (const listener of sessionListeners) {
    listener();
  }
}

export function useActiveVideoExportSession(): VideoExportSession | undefined {
  return useSyncExternalStore((listener: () => void) => {
    sessionListeners.add(listener);
    return () => {
      sessionListeners.delete(listener);
    };
  }, getActiveVideoExportSession);
}

export function setActiveVideoExportSession(session: VideoExportSession): void {
  activeSession = session;
  emitSessionChange();
}

type FinishDeps = {
  pausePlayback: (() => void) | undefined;
  setPlaybackSpeed: ((speed: number) => void) | undefined;
  setRepeat: Dispatch<SetStateAction<boolean>>;
};

/**
 * Stop the active export (if any), save the captured blob, and restore the
 * playback speed + repeat state that were forced for the real-time recording.
 */
export async function finishVideoExport(deps: FinishDeps): Promise<void> {
  const session = activeSession;
  if (session == undefined || session.phase === "stopping") {
    return;
  }
  session.phase = "stopping";
  deps.pausePlayback?.();
  try {
    const { blob, mimeType } = await session.recorder.stop();
    const extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
    downloadFiles([
      {
        blob,
        fileName: `lichtblick-export-${session.startTime.sec}-${session.endTime.sec}.${extension}`,
      },
    ]);
  } catch (error) {
    sendNotification(
      "Video export failed",
      error instanceof Error ? error.message : String(error),
      "app",
      "error",
    );
  }
  if (session.restoreSpeed != undefined) {
    deps.setPlaybackSpeed?.(session.restoreSpeed);
  }
  deps.setRepeat(session.restoreRepeat);
  activeSession = undefined;
  emitSessionChange();
}

function activeDataSelector(ctx: MessagePipelineContext) {
  return ctx.playerState.activeData;
}

function pausePlaybackSelector(ctx: MessagePipelineContext) {
  return ctx.pausePlayback;
}

function startPlaybackSelector(ctx: MessagePipelineContext) {
  return ctx.startPlayback;
}

function setPlaybackSpeedSelector(ctx: MessagePipelineContext) {
  return ctx.setPlaybackSpeed;
}

/**
 * VideoExportAdapter drives an in-progress video export session.
 *
 * NOTE: Like RepeatAdapter, it receives every message pipeline frame in an isolated
 * component so it does not cause virtual DOM diffing on any children.
 *
 * Arming: the export starts with playback paused at the range start; once currentTime
 * reaches the start (the seek has landed) the recorder starts and playback resumes.
 * The export finishes when currentTime reaches the end, when the user stops it from
 * the dialog, or when the recorded canvas disappears (player/layout remount).
 */
export function VideoExportAdapter(): React.JSX.Element {
  const activeData = useMessagePipeline(activeDataSelector);
  const pausePlayback = useMessagePipeline(pausePlaybackSelector);
  const startPlayback = useMessagePipeline(startPlaybackSelector);
  const setPlaybackSpeed = useMessagePipeline(setPlaybackSpeedSelector);
  const session = useActiveVideoExportSession();
  const {
    playbackControlActions: { setRepeat },
  } = useWorkspaceActions();

  useLayoutEffect(() => {
    if (session == undefined || session.phase === "stopping") {
      return;
    }
    const currentTime = activeData?.currentTime;
    if (currentTime == undefined) {
      return;
    }
    if (
      session.phase === "arming" &&
      compare(currentTime, session.startTime) <= 0
    ) {
      // paused playback means currentTime does not advance past startTime before we
      // see it, so this fires exactly when the seek back to the range start has landed
      session.phase = "recording";
      session.recorder.start();
      startPlayback?.();
    }
    if (
      session.phase === "recording" &&
      compare(currentTime, session.endTime) >= 0
    ) {
      void finishVideoExport({ pausePlayback, setPlaybackSpeed, setRepeat });
    }
  }, [
    activeData,
    session,
    pausePlayback,
    startPlayback,
    setPlaybackSpeed,
    setRepeat,
  ]);

  // abort + save what was captured when the recorded canvas goes away
  useEffect(() => {
    return subscribeRecordableCanvases(() => {
      const current = getActiveVideoExportSession();
      if (
        current != undefined &&
        !getRecordableCanvases().some((e) => e.id === current.canvasId)
      ) {
        void finishVideoExport({ pausePlayback, setPlaybackSpeed, setRepeat });
      }
    });
  }, [pausePlayback, setPlaybackSpeed, setRepeat]);

  return <></>;
}

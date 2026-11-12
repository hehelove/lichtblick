// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Stack from "@lichtblick/suite-base/components/Stack";
import {
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";
import { formatTimeRaw } from "@lichtblick/suite-base/util/time";

import {
  finishVideoExport,
  setActiveVideoExportSession,
  useActiveVideoExportSession,
} from "./VideoExportAdapter";
import {
  createCanvasRecorder,
  pickVideoMimeType,
} from "./videoExport/canvasRecorder";
import { useRecordableCanvases } from "./videoExport/recordableCanvases";

const FPS_CHOICES = [15, 30, 60];

const selectPresence = (ctx: MessagePipelineContext) =>
  ctx.playerState.presence;
const selectPlayUntilDefined = (ctx: MessagePipelineContext) =>
  ctx.playUntil != undefined;
const selectPlaybackRepeat = (store: WorkspaceContextStore) =>
  store.playbackControls.repeat;
const selectRangeText = (ctx: MessagePipelineContext): string | undefined => {
  const { startTime, endTime } = ctx.playerState.activeData ?? {};
  if (startTime == undefined || endTime == undefined) {
    return undefined;
  }
  return `${formatTimeRaw(startTime)} → ${formatTimeRaw(endTime)}`;
};

/**
 * Pure gate for the Start button so the individual conditions stay testable
 * (the mock message pipeline always exposes playUntil, so the live-source branch
 * cannot be driven through the component harness).
 */
export function canStartVideoExport(args: {
  mimeType: string | undefined;
  hasPlayUntil: boolean;
  presence: PlayerPresence;
  hasCanvas: boolean;
}): boolean {
  return (
    args.mimeType != undefined &&
    args.hasPlayUntil &&
    args.presence === PlayerPresence.PRESENT &&
    args.hasCanvas
  );
}

/**
 * VideoExportDialog configures and monitors a canvas video export.
 *
 * It reads the player state itself via the message pipeline (like RepeatAdapter)
 * so its only prop is onClose. The export itself is driven by VideoExportAdapter.
 */
export function VideoExportDialog({
  onClose,
}: {
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation("videoExport");

  const canvases = useRecordableCanvases();
  const [selectedCanvasId, setSelectedCanvasId] = useState<
    string | undefined
  >();
  const [fps, setFps] = useState(30);
  const session = useActiveVideoExportSession();

  const presence = useMessagePipeline(selectPresence);
  const playUntilDefined = useMessagePipeline(selectPlayUntilDefined);
  const rangeText = useMessagePipeline(selectRangeText);
  const repeat = useWorkspaceStore(selectPlaybackRepeat);
  const getMessagePipeline = useMessagePipelineGetter();
  const {
    playbackControlActions: { setRepeat },
  } = useWorkspaceActions();

  const mimeType = useMemo(() => pickVideoMimeType(), []);
  const selected =
    canvases.find((entry) => entry.id === selectedCanvasId) ?? canvases[0];

  const disabledReason = useMemo(() => {
    if (mimeType == undefined) {
      return t("unsupportedBrowser");
    }
    if (!playUntilDefined) {
      return t("liveSourceRequired");
    }
    if (presence !== PlayerPresence.PRESENT) {
      return t("playerNotReady");
    }
    return undefined;
  }, [mimeType, playUntilDefined, presence, t]);

  const startDisabled =
    session != undefined ||
    disabledReason != undefined ||
    !canStartVideoExport({
      mimeType,
      hasPlayUntil: playUntilDefined,
      presence,
      hasCanvas: selected != undefined,
    });

  const onStart = useCallback(() => {
    const activeData = getMessagePipeline().playerState.activeData;
    const startTime = activeData?.startTime;
    const endTime = activeData?.endTime;
    const speed = activeData?.speed;
    if (
      selected == undefined ||
      session != undefined ||
      startTime == undefined ||
      endTime == undefined ||
      !canStartVideoExport({
        mimeType,
        hasPlayUntil: playUntilDefined,
        presence,
        hasCanvas: true,
      })
    ) {
      return;
    }
    const recorder = createCanvasRecorder(selected.canvas, {
      fps,
      mimeType: mimeType!,
    });

    // MediaRecorder timestamps frames with the wall clock: record in real time at 1x
    // with repeat off, parked at the range start while paused, and restore afterwards.
    setActiveVideoExportSession({
      canvasId: selected.id,
      title: selected.title,
      fps,
      mimeType: mimeType!,
      startTime,
      endTime,
      recorder,
      restoreSpeed: speed,
      restoreRepeat: repeat,
      phase: "arming",
    });
    setRepeat(false);
    const pipeline = getMessagePipeline();
    pipeline.setPlaybackSpeed?.(1);
    pipeline.pausePlayback?.();
    pipeline.seekPlayback?.(startTime);
  }, [
    fps,
    getMessagePipeline,
    mimeType,
    playUntilDefined,
    presence,
    repeat,
    selected,
    session,
    setRepeat,
  ]);

  const onStop = useCallback(() => {
    const pipeline = getMessagePipeline();
    void finishVideoExport({
      pausePlayback: pipeline.pausePlayback,
      setPlaybackSpeed: pipeline.setPlaybackSpeed,
      setRepeat,
    });
  }, [getMessagePipeline, setRepeat]);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t("title")}</DialogTitle>
      <DialogContent>
        {session != undefined ? (
          <Typography paddingY={1}>
            {t("recording", { title: session.title, fps: session.fps })}
          </Typography>
        ) : (
          <FormControl>
            <Stack direction="column" gap={2}>
              {canvases.length > 0 ? (
                <TextField
                  select
                  fullWidth
                  label={t("panel")}
                  value={selected?.id}
                  onChange={(event) => {
                    setSelectedCanvasId(event.target.value);
                  }}
                >
                  {canvases.map((entry) => (
                    <MenuItem key={entry.id} value={entry.id}>
                      {entry.title}
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                <Typography paddingY={1}>{t("noPanels")}</Typography>
              )}
              <TextField
                select
                fullWidth
                label={t("frameRate")}
                value={fps}
                onChange={(event) => {
                  setFps(Number(event.target.value));
                }}
              >
                {FPS_CHOICES.map((choice) => (
                  <MenuItem key={choice} value={choice}>
                    {choice}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <Typography paddingY={1}>
              {t("range")}: {rangeText ?? "-"}
            </Typography>
            {selected != undefined && (
              <Typography>
                {t("outputSize")}: {selected.canvas.width}×
                {selected.canvas.height} px
              </Typography>
            )}
            {disabledReason != undefined && (
              <Typography color="warning.main">{disabledReason}</Typography>
            )}
            <Typography variant="body2" color="text.secondary" paddingY={1}>
              {t("note")}
            </Typography>
          </FormControl>
        )}
      </DialogContent>
      <DialogActions>
        {session != undefined ? (
          <Button onClick={onStop} color="primary">
            {t("stop")}
          </Button>
        ) : (
          <Button onClick={onStart} disabled={startDisabled} color="primary">
            {t("start")}
          </Button>
        )}
        <Button onClick={onClose}>{t("close")}</Button>
      </DialogActions>
    </Dialog>
  );
}

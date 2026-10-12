// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ColumnSingleCompare20Filled } from "@fluentui/react-icons";
import { Divider, IconButton, Popover, Stack, TextField, Typography } from "@mui/material";
import { enqueueSnackbar } from "notistack";
import path from "path";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { AppBarIconButton } from "@lichtblick/suite-base/components/AppBar/AppBarIconButton";
import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import TextMiddleTruncate from "@lichtblick/suite-base/components/TextMiddleTruncate";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { FILE_ACCEPT_TYPE } from "@lichtblick/suite-base/context/Workspace/constants";
import { normalizeExtensions } from "@lichtblick/suite-base/context/Workspace/utils";
import {
  COMPARE_EXTENSIONS,
  COMPARE_SOURCE_ID,
} from "@lichtblick/suite-base/dataSources/CompareFilesDataSourceFactory";
import {
  SLOT_LETTERS,
  useCompareStore,
  useIsComparisonSession,
} from "@lichtblick/suite-base/dataSources/compareStore";
import showOpenFilePicker from "@lichtblick/suite-base/util/showOpenFilePicker";

const useStyles = makeStyles()((theme) => ({
  slotBadge: {
    width: 20,
    height: 20,
    lineHeight: "20px",
    textAlign: "center",
    borderRadius: "50%",
    backgroundColor: theme.palette.action.selected,
  },
  offsetInput: {
    width: 140,
  },
}));

/**
 * AppBar badge shown while a comparison session is active. The popover lists one row per slot
 * (letter badge, file name, offset in seconds, remove button) plus an "Add file…" entry that
 * appends a slot. Every commit path funnels through one rebuild() that re-selects the
 * compare-files source with the full slot list — the factory's sessionFor sees the same File
 * objects and keeps offsets alive instead of starting a new session.
 */
export function CompareSourcesButton(): React.JSX.Element | null {
  const { t } = useTranslation("appBar");
  const isComparison = useIsComparisonSession();
  const slots = useCompareStore((state) => state.slots);
  const { selectSource } = usePlayerSelection();
  const playerName = useMessagePipeline((ctx) => ctx.playerState.name);
  const prevName = useRef<string | undefined>(undefined);
  const [anchorEl, setAnchorEl] = useState<HTMLElement>();

  // 幽灵 popover 修复:会话结束(anchorEl 残留)后新会话会把 popover 锚到已脱离的节点上。
  // 不能用 isComparison 变 false 来关——每次 offset/槽位提交都会重建 player,pipeline 先派发
  // defaultPlayerState()(name 为 undefined)再回到比较名,name 会闪烁一次,那样会误关。
  // 只认两类"真换源":非比较名称的真实源接管;或 name 连续两次为空(会话真正结束)。
  useEffect(() => {
    const differentSource = playerName != undefined && !playerName.startsWith("Comparison: ");
    const sessionEnded = playerName == undefined && prevName.current == undefined;
    if (differentSource || sessionEnded) {
      setAnchorEl(undefined);
    }
    prevName.current = playerName;
  }, [playerName]);

  if (!isComparison) {
    return null;
  }

  const rebuild = (): void => {
    const files = useCompareStore.getState().slots.map((slot) => slot.file);
    selectSource(COMPARE_SOURCE_ID, { type: "file", files });
  };

  // 追加槽位(spec §8):挑选→校验→addFiles→整批重建。不能走 useOpenCompareFiles——
  // 那会 selectSource 仅新文件,sessionFor 判定为新会话,替换现有槽位。
  const addFile = async (): Promise<void> => {
    const room = SLOT_LETTERS.length - useCompareStore.getState().slots.length;
    if (room <= 0) {
      return;
    }
    const extensions = normalizeExtensions(COMPARE_EXTENSIONS);
    const handles = await showOpenFilePicker({
      multiple: true,
      types: [
        {
          description: "Comparison files",
          accept: { [FILE_ACCEPT_TYPE]: extensions },
        },
      ],
    });
    if (handles.length === 0) {
      return;
    }
    const files = await Promise.all(handles.map(async (handle) => await handle.getFile()));
    const unsupported = files.filter(
      (file) => !COMPARE_EXTENSIONS.includes(path.extname(file.name).toLowerCase()),
    );
    if (unsupported.length > 0) {
      enqueueSnackbar(
        t("comparisonUnsupported", { files: unsupported.map((f) => f.name).join(", ") }),
        { variant: "error" },
      );
      return;
    }
    // T5 store 的 addFiles 会静默截断超量文件——追加路径在这里显式拒绝(镜像 T6 入口守卫)。
    if (files.length > room) {
      enqueueSnackbar(t("addFileRoom", { room }), { variant: "error" });
      return;
    }
    useCompareStore.getState().addFiles(files);
    rebuild();
  };

  const popoverOpen = anchorEl != undefined;

  return (
    <>
      <AppBarIconButton
        color="inherit"
        title={t("comparisonSources")}
        aria-label={t("comparisonSources")}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen ? "true" : undefined}
        aria-controls={popoverOpen ? "comparison-sources-popover" : undefined}
        data-testid="CompareSourcesButton"
        onClick={(event) => {
          setAnchorEl(event.currentTarget);
        }}
      >
        <ColumnSingleCompare20Filled />
      </AppBarIconButton>
      <Popover
        id={popoverOpen ? "comparison-sources-popover" : undefined}
        open={popoverOpen}
        anchorEl={anchorEl}
        onClose={() => {
          setAnchorEl(undefined);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Stack padding={1.5} gap={1} minWidth={360}>
          {slots.map((slot) => (
            <SlotRow
              key={slot.slot}
              slot={slot}
              onOffsetCommit={(ns) => {
                useCompareStore.getState().setOffset(slot.slot, ns);
                rebuild();
              }}
              onRemove={() => {
                useCompareStore.getState().removeSlot(slot.slot);
                rebuild();
              }}
            />
          ))}
          <Divider />
          <IconButton
            size="small"
            disabled={slots.length >= SLOT_LETTERS.length}
            onClick={() => {
              void addFile();
            }}
          >
            <Typography variant="inherit">{t("addFile")}</Typography>
          </IconButton>
        </Stack>
      </Popover>
    </>
  );
}

function SlotRow(props: {
  slot: { slot: string; fileName: string; offsetNs: bigint };
  onOffsetCommit: (offsetNs: bigint) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const { t } = useTranslation("appBar");
  const { classes } = useStyles();
  const [text, setText] = useState(() => (Number(props.slot.offsetNs) / 1e9).toString());
  const [error, setError] = useState(false);
  const canRemove = useCompareStore((state) => state.slots.length > 1);
  // 重建后 popover 不 remount,useState 初值只取一次;同步外部 offsetNs 变化。文本是
  // offsetNs 的纯函数,removeSlot 重排字母(删 B 后原 C 变 B)复用行时,offsetNs 变化即重置。
  useEffect(() => {
    setText((Number(props.slot.offsetNs) / 1e9).toString());
  }, [props.slot.offsetNs]);

  const commit = (): void => {
    const seconds = Number(text);
    if (text.trim() === "" || !Number.isFinite(seconds)) {
      setError(true);
      return;
    }
    setError(false);
    props.onOffsetCommit(BigInt(Math.round(seconds * 1e9)));
  };

  return (
    <Stack direction="row" alignItems="center" gap={1}>
      <Typography variant="body2" fontWeight="bold" component="span" className={classes.slotBadge}>
        {props.slot.slot}
      </Typography>
      <TextMiddleTruncate text={props.slot.fileName} />
      <TextField
        size="small"
        variant="filled"
        label={t("offsetSeconds", { slot: props.slot.slot })}
        value={text}
        error={error}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
          }
        }}
        onBlur={commit}
        slotProps={{ htmlInput: { step: 0.1 } }}
        className={classes.offsetInput}
      />
      <IconButton
        size="small"
        title={t("removeSlot", { slot: props.slot.slot })}
        disabled={!canRemove}
        onClick={props.onRemove}
      >
        ✕
      </IconButton>
    </Stack>
  );
}

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { enqueueSnackbar } from "notistack";
import path from "path";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { FILE_ACCEPT_TYPE } from "@lichtblick/suite-base/context/Workspace/constants";
import { normalizeExtensions } from "@lichtblick/suite-base/context/Workspace/utils";
import {
  COMPARE_EXTENSIONS,
  COMPARE_SOURCE_ID,
} from "@lichtblick/suite-base/dataSources/CompareFilesDataSourceFactory";
import { SLOT_LETTERS } from "@lichtblick/suite-base/dataSources/compareStore";
import showOpenFilePicker from "@lichtblick/suite-base/util/showOpenFilePicker";

/**
 * Opens a multi-select file picker and starts a comparison session by selecting the
 * "compare-files" source with the picked files. Slot-count and extension guards run here so
 * the user gets a snackbar instead of a failed player init (the factory re-checks both).
 */
export function useOpenCompareFiles(): () => Promise<void> {
  const { selectSource } = usePlayerSelection();
  const { t } = useTranslation("appBar");

  const extensions = useMemo(() => normalizeExtensions(COMPARE_EXTENSIONS), []);

  return useCallback(async () => {
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

    if (files.length > SLOT_LETTERS.length) {
      enqueueSnackbar(t("compareMaxFiles", { count: SLOT_LETTERS.length }), {
        variant: "error",
      });
      return;
    }
    const unsupported = files.filter(
      (file) => !COMPARE_EXTENSIONS.includes(path.extname(file.name).toLowerCase()),
    );
    if (unsupported.length > 0) {
      enqueueSnackbar(
        t("comparisonUnsupported", { files: unsupported.map((file) => file.name).join(", ") }),
        { variant: "error" },
      );
      return;
    }

    selectSource(COMPARE_SOURCE_ID, { type: "file", files });
  }, [extensions, selectSource, t]);
}

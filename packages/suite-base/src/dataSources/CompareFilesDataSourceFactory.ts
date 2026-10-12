// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import path from "path";

import { AllowedFileExtensions } from "@lichtblick/suite-base/constants/allowedFileExtensions";
import {
  DataSourceFactoryInitializeArgs,
  IDataSourceFactory,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { IterablePlayer } from "@lichtblick/suite-base/players/IterablePlayer";
import { CompareIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/CompareIterableSource";
import { DeserializingIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/DeserializingIterableSource";
import { IDeserializedIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/IIterableSource";
import { Player } from "@lichtblick/suite-base/players/types";

import { buildMcapSource } from "./McapLocalDataSourceFactory";
import { buildRos1BagSource } from "./Ros1LocalBagDataSourceFactory";
import { buildRos2BagSource } from "./Ros2LocalBagDataSourceFactory";
import { buildUlogSource } from "./UlogLocalDataSourceFactory";
import { SLOT_LETTERS, useCompareStore } from "./compareStore";

export const COMPARE_SOURCE_ID = "compare-files";

/** Extensions every compare slot can route — exactly what the four local factories declare. */
export const COMPARE_EXTENSIONS: string[] = [
  AllowedFileExtensions.MCAP,
  AllowedFileExtensions.BAG,
  AllowedFileExtensions.DB3,
  AllowedFileExtensions.ULG,
  AllowedFileExtensions.ULOG,
];

function buildSlotSource(file: File): IDeserializedIterableSource {
  const ext = path.extname(file.name).toLowerCase();
  switch (ext) {
    case AllowedFileExtensions.MCAP:
      return new DeserializingIterableSource(buildMcapSource([file]));
    case AllowedFileExtensions.BAG:
      return new DeserializingIterableSource(buildRos1BagSource(file));
    case AllowedFileExtensions.DB3:
      return new DeserializingIterableSource(buildRos2BagSource([file]));
    case AllowedFileExtensions.ULG:
    case AllowedFileExtensions.ULOG:
      return buildUlogSource(file); // 本就是 deserialized
    default:
      throw new Error(`Comparison does not support ${file.name} (${ext})`);
  }
}

/**
 * File-source comparison (Foxglove Comparison mode, core parity). Each picked file becomes an
 * A/B/C slot; CompareIterableSource merges them onto one elapsed timeline with `@slot` topic
 * suffixes. Rebuilds (offset/slot edits) keep a stable playerId so panels don't remount.
 *
 * Deliberately declares no `supportedFileTypes`, keeping it invisible to generic open/drag-drop
 * routing; the only entry is the "Compare files…" menu action.
 */
class CompareFilesDataSourceFactory implements IDataSourceFactory {
  public id = COMPARE_SOURCE_ID;
  public type: IDataSourceFactory["type"] = "file";
  public displayName = "Comparison (files)";
  public iconName: IDataSourceFactory["iconName"] = "OpenFile";
  public supportsMultiFile = true;

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const files = args.files ?? [];
    if (args.file != undefined) {
      files.push(args.file);
    }
    if (files.length === 0) {
      return;
    }

    const unsupported = files.filter(
      (file) => !COMPARE_EXTENSIONS.includes(path.extname(file.name).toLowerCase()),
    );
    if (unsupported.length > 0) {
      throw new Error(
        `Comparison does not support: ${unsupported.map((file) => file.name).join(", ")}`,
      );
    }
    if (files.length > SLOT_LETTERS.length) {
      throw new Error(`Comparison supports at most ${SLOT_LETTERS.length} files`);
    }

    // 先落会话状态(rebuild 判定),再读回偏移与 playerId
    useCompareStore.getState().sessionFor(files);
    const { slots, playerId } = useCompareStore.getState();

    const source = new CompareIterableSource({
      slots: files.map((file, i) => ({
        source: buildSlotSource(file),
        slot: slots[i]?.slot ?? SLOT_LETTERS[i]!,
        fileName: file.name,
      })),
      offsets: new Map(slots.map((slot) => [slot.slot, slot.offsetNs])),
    });

    return new IterablePlayer({
      metricsCollector: args.metricsCollector,
      source,
      name: `Comparison: ${files.map((file) => file.name).join(", ")}`,
      sourceId: this.id,
      playerId,
      // 仅对 serialized 分支生效;deserialized 走 BufferedIterableSource 默认缓冲(spec §5 裁决)
      readAheadDuration: { sec: 120, nsec: 0 },
    });
  }
}

export default CompareFilesDataSourceFactory;

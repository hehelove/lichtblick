// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useMemo } from "react";

import { Time } from "@lichtblick/rostime";
import { MessageDataItemsByPath } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import { ChartDatasets } from "@lichtblick/suite-base/components/TimeBasedChart/types";
import {
  ROW_MARGIN,
  ROW_SPACING,
} from "@lichtblick/suite-base/panels/StateTransitions/hooks/constants";
import { UseStateTransitionsData } from "@lichtblick/suite-base/panels/StateTransitions/hooks/types";
import {
  messagesToDataset,
  messagesToDynamicDatasets,
} from "@lichtblick/suite-base/panels/StateTransitions/messagesToDataset";
import {
  datasetContainsArray,
  getDynamicFields,
  getDynamicSeries,
} from "@lichtblick/suite-base/panels/StateTransitions/shared";
import {
  PathState,
  StateTransitionPath,
} from "@lichtblick/suite-base/panels/StateTransitions/types";

function useStateTransitionsData(
  paths: StateTransitionPath[],
  startTime: Readonly<Time> | undefined,
  itemsByPath: MessageDataItemsByPath,
  decodedBlocks: MessageDataItemsByPath[],
  // eslint-disable-next-line @lichtblick/no-boolean-parameters
  showPoints: boolean,
): UseStateTransitionsData {
  return useMemo(() => {
    // ignore all data when we don't have a start time
    if (!startTime) {
      return {
        data: { datasets: [] },
        minY: undefined,
        pathState: [],
      };
    }

    let outMinY: number | undefined;
    const outDatasets: ChartDatasets = [];
    const outPathState: PathState[] = [];

    let rowIndex = 0;
    paths.forEach((path, pathIndex) => {
      const blocksForPath = decodedBlocks.map((decodedBlock) => decodedBlock[path.value]);
      const items = itemsByPath[path.value];
      const allData = [...blocksForPath, items];
      const { labelField, valueField } = getDynamicFields(path);
      const dynamicSeries = getDynamicSeries(allData, labelField, valueField);
      const rows = dynamicSeries.length > 0 ? dynamicSeries : [undefined];

      const isArray = datasetContainsArray([...blocksForPath, items]);

      outPathState.push({
        path,
        isArray: dynamicSeries.length === 0 && isArray,
        dynamicSeries,
      });
      const yValues = rows.map(() => {
        const y = -(rowIndex + 1) * ROW_SPACING;
        outMinY = Math.min(outMinY ?? y, y - ROW_MARGIN);
        rowIndex++;
        return y;
      });
      if (dynamicSeries.length > 0) {
        const blockDatasets = messagesToDynamicDatasets({
          blocks: blocksForPath,
          path,
          pathIndex,
          startTime,
          showPoints,
          dynamicSeries,
          yValues,
        });
        const itemDatasets =
          items == undefined
            ? []
            : messagesToDynamicDatasets({
                blocks: [items],
                path,
                pathIndex,
                startTime,
                showPoints,
                dynamicSeries,
                yValues,
              });
        dynamicSeries.forEach((_, index) => {
          outDatasets.push(blockDatasets[index]!);
          if (itemDatasets[index] != undefined) {
            outDatasets.push(itemDatasets[index]);
          }
        });
        return;
      }

      for (const [index, series] of rows.entries()) {
        const y = yValues[index]!;
        outDatasets.push(
          messagesToDataset({
            blocks: blocksForPath,
            path,
            pathIndex,
            startTime,
            y,
            showPoints,
            dynamicSeries: series,
          }),
        );
        if (items != undefined) {
          outDatasets.push(
            messagesToDataset({
              blocks: [items],
              path,
              pathIndex,
              startTime,
              y,
              showPoints,
              dynamicSeries: series,
            }),
          );
        }
      }
    });

    return {
      data: { datasets: outDatasets },
      minY: outMinY,
      pathState: outPathState,
    };
  }, [decodedBlocks, itemsByPath, paths, startTime, showPoints]);
}

export default useStateTransitionsData;

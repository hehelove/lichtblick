// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageAndData } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import {
  ImmutableDataset,
  StateTransitionPath,
} from "@lichtblick/suite-base/panels/StateTransitions/types";
import MessageEventBuilder from "@lichtblick/suite-base/testing/builders/MessageEventBuilder";
import { BasicBuilder } from "@lichtblick/test-builders";

import {
  datasetContainsArray,
  getDynamicFields,
  getDynamicSeries,
  stateTransitionPathDisplayName,
} from "./shared";

describe("stateTransitionPathDisplayName", () => {
  function buildStateTransitionPath(
    overrideProps: Partial<StateTransitionPath> = {},
  ): StateTransitionPath {
    return {
      timestampMethod: BasicBuilder.sample(["receiveTime", "headerStamp"]),
      value: BasicBuilder.string(),
      enabled: true,
      label: BasicBuilder.string(),
      ...overrideProps,
    };
  }

  it("should return the path label if it is defined", () => {
    const path: StateTransitionPath = buildStateTransitionPath();
    expect(stateTransitionPathDisplayName(path, 0)).toEqual(path.label);
  });

  it("should return the path value if label is empty", () => {
    const path: StateTransitionPath = buildStateTransitionPath({
      label: "",
    });
    expect(stateTransitionPathDisplayName(path, 0)).toEqual(path.value);
  });

  it("should return the path value if label is undefined", () => {
    const path: StateTransitionPath = buildStateTransitionPath({
      label: undefined,
    });
    expect(stateTransitionPathDisplayName(path, 0)).toEqual(path.value);
  });

  it("should return the fallback display name if neither label or value are empty", () => {
    const path: StateTransitionPath = buildStateTransitionPath({
      label: "",
      value: "",
    });
    expect(stateTransitionPathDisplayName(path, 0)).toEqual("Series 1");
    expect(stateTransitionPathDisplayName(path, 1)).toEqual("Series 2");
    expect(stateTransitionPathDisplayName(path, 42)).toEqual("Series 43");
  });
});

describe("datasetContainsArray", () => {
  const createMessageAndData = (queriedDataLength: number): MessageAndData => ({
    messageEvent: MessageEventBuilder.messageEvent(), // Mock the MessageEvent
    queriedData: new Array(queriedDataLength).fill({}), // Create an array of the specified length
  });

  it("should return false for an empty dataset", () => {
    const dataset: ImmutableDataset = [];
    expect(datasetContainsArray(dataset)).toBe(false);
  });

  it("should return false when all elements are undefined", () => {
    const dataset: ImmutableDataset = [undefined, undefined];
    expect(datasetContainsArray(dataset)).toBe(false);
  });

  it("should return false when the dataset contains mixed undefined and empty arrays", () => {
    const dataset: ImmutableDataset = [undefined, []];
    expect(datasetContainsArray(dataset)).toBe(false);
  });

  it("should return false for a single MessageAndData[] element with queriedData of length 1", () => {
    const dataset: ImmutableDataset = [[createMessageAndData(1)]];
    expect(datasetContainsArray(dataset)).toBe(false);
  });

  it("should return true for a single MessageAndData[] element with queriedData of length greater than 1", () => {
    const dataset: ImmutableDataset = [[createMessageAndData(2)]];
    expect(datasetContainsArray(dataset)).toBe(true);
  });

  it("should return true for multiple MessageAndData[] elements with consistent queriedData lengths greater than 1", () => {
    const dataset: ImmutableDataset = [[createMessageAndData(2)], [createMessageAndData(2)]];
    expect(datasetContainsArray(dataset)).toBe(true);
  });

  it("should return false for multiple MessageAndData[] elements with mixed queriedData lengths, including lengths less than or equal to 1", () => {
    const dataset: ImmutableDataset = [[createMessageAndData(2)], [createMessageAndData(1)]];
    expect(datasetContainsArray(dataset)).toBe(false);
  });
});

describe("getDynamicSeries", () => {
  function msgWithValue(value: unknown): MessageAndData[] {
    return [
      {
        messageEvent: MessageEventBuilder.messageEvent(),
        queriedData: [{ path: "/states", value }],
      },
    ];
  }

  it("expands object arrays in first-seen order with type-stable identities", () => {
    const dataset: ImmutableDataset = [
      [
        {
          messageEvent: MessageEventBuilder.messageEvent(),
          queriedData: [
            {
              path: "/states",
              value: [
                { label: 1, value: "numeric" },
                { label: "1", value: "string" },
              ],
            },
          ],
        },
      ],
    ];

    expect(getDynamicSeries(dataset, "label", "value")).toEqual([
      { identity: "number:1", label: "1" },
      { identity: "string:1", label: "1" },
    ]);
  });

  it("ignores entries without valid label and value fields", () => {
    const dataset: ImmutableDataset = [
      [
        {
          messageEvent: MessageEventBuilder.messageEvent(),
          queriedData: [
            {
              path: "/states",
              value: [
                { label: "valid", value: true },
                { label: "missing-value" },
                { label: {}, value: 1 },
              ],
            },
          ],
        },
      ],
    ];

    expect(getDynamicSeries(dataset, "label", "value")).toEqual([
      { identity: "string:valid", label: "valid" },
    ]);
  });

  it("expands primitive arrays to one row per index", () => {
    const series = getDynamicSeries([msgWithValue([10, 20, 30])], "label", "value");
    expect(series.map((s) => s.identity)).toEqual(["index:0", "index:1", "index:2"]);
    expect(series.map((s) => s.label)).toEqual(["[0]", "[1]", "[2]"]);
    expect(series.map((s) => s.sourceIndex)).toEqual([0, 1, 2]);
  });

  it("object arrays missing label fall back to index rows keyed by valueField", () => {
    const series = getDynamicSeries([msgWithValue([{ value: 1 }, { value: 2 }])], "label", "value");
    expect(series.map((s) => s.identity)).toEqual(["index:0", "index:1"]);
  });

  it("any valid label keeps the array label-keyed (all-or-nothing)", () => {
    const series = getDynamicSeries(
      [msgWithValue([{ label: "a", value: 1 }, { value: 2 }])],
      "label",
      "value",
    );
    expect(series.map((s) => s.identity)).toEqual(["string:a"]); // unlabeled entries are dropped as before
  });

  it("row count grows to the max array length across messages", () => {
    const series = getDynamicSeries([msgWithValue([1]), msgWithValue([1, 2, 3])], "label", "value");
    expect(series).toHaveLength(3);
  });

  it("index identity never collides with a numeric label", () => {
    expect(getDynamicSeries([msgWithValue([{ label: 0, value: 9 }])], "label", "value")[0]!.identity).toBe(
      "number:0",
    );
    expect(getDynamicSeries([msgWithValue([9])], "label", "value")[0]!.identity).toBe("index:0");
  });
});

describe("getDynamicFields", () => {
  const path: StateTransitionPath = { value: "/states", timestampMethod: "receiveTime" };

  it("uses label and value when either or both fields are blank", () => {
    expect(getDynamicFields(path)).toEqual({ labelField: "label", valueField: "value" });
    expect(getDynamicFields({ ...path, dynamicLabelField: "name" })).toEqual({
      labelField: "name",
      valueField: "value",
    });
    expect(getDynamicFields({ ...path, dynamicValueField: "state" })).toEqual({
      labelField: "label",
      valueField: "state",
    });
    expect(getDynamicFields({ ...path, dynamicLabelField: "", dynamicValueField: "" })).toEqual({
      labelField: "label",
      valueField: "value",
    });
  });

  it("allows both defaults to be overridden", () => {
    expect(
      getDynamicFields({ ...path, dynamicLabelField: "name", dynamicValueField: "state" }),
    ).toEqual({ labelField: "name", valueField: "state" });
  });
});

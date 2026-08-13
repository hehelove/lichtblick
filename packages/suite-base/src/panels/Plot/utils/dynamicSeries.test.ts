// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { parseMessagePath } from "@lichtblick/message-path";

import { DynamicSeriesResolver, resolveDynamicSeries } from "./dynamicSeries";
import { SeriesConfigKey, SeriesItem } from "../builders/IDatasetsBuilder";

describe("resolveDynamicSeries", () => {
  it("uses typed labels in stable identities and lets the last duplicate win", () => {
    const result = resolveDynamicSeries(
      [
        { label: 1, value: 10 },
        { label: "1", value: 20 },
        { label: 1, value: 30 },
      ],
      { configKey: "parent", labelField: "label", valueField: "value" },
    );

    expect(result).toEqual([
      expect.objectContaining({ identity: "parent:number:1", label: "1", value: 30 }),
      expect.objectContaining({ identity: "parent:string:1", label: "1", value: 20 }),
    ]);
  });

  it("supports nested fields and ignores invalid entries", () => {
    expect(
      resolveDynamicSeries(
        [{ meta: { name: "left" }, sample: { current: 2 } }, { sample: { current: 3 } }],
        { configKey: "parent", labelField: "meta.name", valueField: "sample.current" },
      ),
    ).toEqual([
      expect.objectContaining({ identity: "parent:string:left", label: "left", value: 2 }),
    ]);
  });

  it("defaults either field independently when only the other field is configured", () => {
    expect(
      resolveDynamicSeries([{ name: "left", value: 2 }], {
        configKey: "parent",
        labelField: "name",
        valueField: "value",
      }),
    ).toEqual([expect.objectContaining({ label: "left", value: 2 })]);
    expect(
      resolveDynamicSeries([{ label: "right", reading: 3 }], {
        configKey: "parent",
        labelField: "label",
        valueField: "reading",
      }),
    ).toEqual([expect.objectContaining({ label: "right", value: 3 })]);
  });

  it("preserves child identity while inheriting updated parent styling", () => {
    const resolver = new DynamicSeriesResolver();
    const parent = makeSeries({
      color: "red",
      lineSize: 1,
      showLine: true,
      dynamicColorOverride: true,
    });
    resolver.setSeries([parent]);
    resolver.resolve(parent, [{ label: "a", value: 1 }]);
    const identity = resolver.getSeries()[0]!.compositeKey;

    resolver.setSeries([{ ...parent, color: "blue", lineSize: 3, showLine: false }]);

    expect(resolver.getSeries()).toEqual([
      expect.objectContaining({
        compositeKey: identity,
        color: "blue",
        lineSize: 3,
        showLine: false,
      }),
    ]);
  });

  it("removes children when dynamic fields produce a new parent key", () => {
    const resolver = new DynamicSeriesResolver();
    const parent = makeSeries({ key: "label-field" as SeriesConfigKey });
    resolver.setSeries([parent]);
    resolver.resolve(parent, [{ label: "old", value: 1 }]);

    const updated = makeSeries({
      key: "name-field" as SeriesConfigKey,
      dynamicLabelField: "name",
    });
    resolver.setSeries([updated]);

    expect(resolver.getSeries()).toEqual([]);
    expect(resolver.getChildren(parent.key)).toEqual([]);
  });

  it("reassigns dynamic indices when a regular series is added after labels are discovered", () => {
    const resolver = new DynamicSeriesResolver();
    const parent = makeSeries({});
    resolver.setSeries([parent]);
    resolver.resolve(parent, [
      { label: "a", value: 1 },
      { label: "b", value: 2 },
    ]);

    const regular = makeSeries({
      key: "regular" as SeriesConfigKey,
      configIndex: 1,
      dynamicLabelField: undefined,
    });
    resolver.setSeries([parent, regular]);

    expect(resolver.getSeries()).toEqual([
      expect.objectContaining({ subLabel: "a", configIndex: 0 }),
      expect.objectContaining({ subLabel: "b", configIndex: 2 }),
      expect.objectContaining({ key: regular.key, configIndex: 1 }),
    ]);
    expect(new Set(resolver.getSeries().map((series) => series.configIndex)).size).toBe(3);
  });
});

function makeSeries(overrides: Partial<SeriesItem>): SeriesItem {
  return {
    key: "parent" as SeriesConfigKey,
    configIndex: 0,
    messagePath: "/foo.values",
    parsed: parseMessagePath("/foo.values")!,
    color: "red",
    contrastColor: "blue",
    timestampMethod: "receiveTime",
    showLine: true,
    lineSize: 1,
    enabled: true,
    dynamicLabelField: "label",
    ...overrides,
  };
}

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";

import { map } from "@lichtblick/suite-base/i18n/en/map";

import { buildSettingsTree, Config } from "./config";

function makeConfig(layer: string): Config {
  return {
    center: undefined,
    customTileUrl: "https://example.com/{z}/{x}/{y}",
    disabledTopics: [],
    followTopic: "",
    layer,
    topicColors: {},
    zoomLevel: undefined,
    maxNativeZoom: 18,
  };
}

describe("buildSettingsTree", () => {
  const t: TFunction<"map"> = jest.fn((key: string) =>
    key.split(".").reduce<Record<string, any>>((obj, part) => obj[part], map),
  ) as unknown as TFunction<"map">;

  it("offers all five tile layer options", () => {
    const tree = buildSettingsTree(makeConfig("map"), [], t);

    const layerField = tree.general?.fields?.layer;
    expect(layerField?.input).toBe("select");
    expect(layerField?.input === "select" && layerField.options).toEqual([
      { label: "Map", value: "map" },
      { label: "Satellite", value: "satellite" },
      { label: "Custom", value: "custom" },
      { label: "Terrain (GEBCO)", value: "terrain" },
      { label: "Nautical (OpenSeaMap)", value: "nautical" },
    ]);
  });

  it("reflects the selected layer value", () => {
    const tree = buildSettingsTree(makeConfig("terrain"), [], t);
    expect(tree.general?.fields?.layer?.value).toBe("terrain");
  });

  it("only shows the custom tile url field for the custom layer", () => {
    for (const layer of ["map", "satellite", "terrain", "nautical"]) {
      const tree = buildSettingsTree(makeConfig(layer), [], t);
      expect(tree.general?.fields?.customTileUrl).toBeUndefined();
    }

    const customTree = buildSettingsTree(makeConfig("custom"), [], t);
    expect(customTree.general?.fields?.customTileUrl).toBeDefined();
  });
});

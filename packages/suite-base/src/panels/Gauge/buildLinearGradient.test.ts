// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { COLOR_MAPS } from "@lichtblick/suite-base/panels/Gauge/constants";
import {
  ColorMapConfig,
  ColorModeConfig,
  GaugeConfig,
} from "@lichtblick/suite-base/panels/Gauge/types";
import { turboColorString } from "@lichtblick/suite-base/util/colorUtils";

import { buildLinearGradient } from "./buildLinearGradient";

type LinearGradientConfig = Pick<GaugeConfig, "colorMap" | "colorMode" | "gradient" | "reverse">;

describe("buildLinearGradient", () => {
  function setup(configOverride: Partial<LinearGradientConfig> = {}): {
    config: LinearGradientConfig;
  } {
    const config: LinearGradientConfig = {
      colorMap: ColorMapConfig.RAINBOW,
      colorMode: ColorModeConfig.COLORMAP,
      gradient: ["#000000", "#FFFFFF"],
      reverse: false,
      ...configOverride,
    };
    return { config };
  }

  it.each([ColorMapConfig.RED_YELLOW_GREEN, ColorMapConfig.RAINBOW])(
    "should generate a gradient for the RED_YELLOW_GREEN and RAINBOW colormaps",
    (colorMap) => {
      const { config } = setup({ colorMap });
      const colorStops = COLOR_MAPS[colorMap];

      const result = buildLinearGradient({ config });

      expect(result).toMatch(/^linear-gradient\(to right, /);
      const expected = `linear-gradient(to right, ${colorStops
        .map((stop) => `${stop.color} ${stop.location * 100}%`)
        .join(",")})`;
      expect(result).toBe(expected);
    },
  );

  it("should generate a gradient for the TURBO colormap", () => {
    const { config } = setup({ colorMap: ColorMapConfig.TURBO });

    const result = buildLinearGradient({ config });

    const numStops = 20;
    const expectedStops = Array.from({ length: numStops }, (_, i) => ({
      color: turboColorString(i / (numStops - 1)),
      location: i / (numStops - 1),
    }));
    const expected = `linear-gradient(to right, ${expectedStops
      .map((stop) => `${stop.color} ${stop.location * 100}%`)
      .join(",")})`;
    expect(result).toBe(expected);
  });

  it("should generate a gradient for the GRADIENT color mode", () => {
    const gradient: [string, string] = ["#FF0000", "#00FF00"];
    const { config } = setup({ colorMode: ColorModeConfig.GRADIENT, gradient });

    const result = buildLinearGradient({ config });

    expect(result).toBe(`linear-gradient(to right, ${gradient[0]} 0%,${gradient[1]} 100%)`);
  });

  it("should reverse the gradient when reverse is true", () => {
    const gradient: [string, string] = ["#FF0000", "#00FF00"];
    const { config } = setup({ colorMode: ColorModeConfig.GRADIENT, gradient, reverse: true });

    const result = buildLinearGradient({ config });

    expect(result).toBe(`linear-gradient(to right, ${gradient[1]} 0%,${gradient[0]} 100%)`);
  });

  it("should fall back to transparent for empty color stops", () => {
    const { config } = setup({ colorMode: "INVALID_MODE" as ColorModeConfig });

    const result = buildLinearGradient({ config });

    expect(result).toBe("transparent");
  });
});

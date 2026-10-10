// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { COLOR_MAPS } from "@lichtblick/suite-base/panels/Gauge/constants";
import {
  ColorStops,
  ColorModeConfig,
  ColorMapConfig,
  GaugeConfig,
} from "@lichtblick/suite-base/panels/Gauge/types";
import { turboColorString } from "@lichtblick/suite-base/util/colorUtils";

export const getColorStops = (
  config: Pick<GaugeConfig, "colorMap" | "colorMode" | "gradient" | "reverse">,
): ColorStops[] => {
  const { colorMap, colorMode, gradient, reverse } = config;
  let colorStops: ColorStops[] = [];

  switch (colorMode) {
    case ColorModeConfig.COLORMAP:
      switch (colorMap) {
        case ColorMapConfig.RED_YELLOW_GREEN:
          colorStops = COLOR_MAPS[ColorMapConfig.RED_YELLOW_GREEN];
          break;
        case ColorMapConfig.RAINBOW:
          colorStops = COLOR_MAPS[ColorMapConfig.RAINBOW];
          break;
        case ColorMapConfig.TURBO: {
          const numStops = 20;
          colorStops = new Array(numStops).fill(undefined).map((_x, i) => ({
            color: turboColorString(i / (numStops - 1)),
            location: i / (numStops - 1),
          }));
          break;
        }
      }
      break;
    case ColorModeConfig.GRADIENT:
      colorStops = [
        { color: gradient[0], location: 0 },
        { color: gradient[1], location: 1 },
      ];
      break;
  }

  if (reverse) {
    colorStops = colorStops
      .map((stop) => ({ color: stop.color, location: 1 - stop.location }))
      .reverse();
  }

  return colorStops;
};

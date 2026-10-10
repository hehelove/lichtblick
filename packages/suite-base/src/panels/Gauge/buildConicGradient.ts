// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { getColorStops } from "@lichtblick/suite-base/panels/Gauge/colorStops";
import { BuildConicGradientProps } from "@lichtblick/suite-base/panels/Gauge/types";

export const buildConicGradient = ({
  config,
  gaugeAngle,
  height,
  width,
}: BuildConicGradientProps): string => {
  const colorStops = getColorStops(config);

  const angleAndPosition = `from ${-Math.PI / 2 + gaugeAngle}rad at 50% ${
    100 * (width / 2 / height)
  }%`;
  const angularColorStop: string =
    colorStops.length > 0
      ? colorStops
          .map((stop) => `${stop.color} ${stop.location * 2 * (Math.PI / 2 - gaugeAngle)}rad`)
          .join(",")
      : "transparent 0%";
  const color = colorStops.length > 0 ? colorStops[0]!.color : "transparent";

  return `conic-gradient(${angleAndPosition}, ${angularColorStop}, ${color})`;
};

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { getColorStops } from "@lichtblick/suite-base/panels/Gauge/colorStops";
import { BuildLinearGradientProps } from "@lichtblick/suite-base/panels/Gauge/types";

export const buildLinearGradient = ({ config }: BuildLinearGradientProps): string => {
  const colorStops = getColorStops(config);
  if (colorStops.length === 0) {
    return "transparent";
  }
  return `linear-gradient(to right, ${colorStops
    .map((stop) => `${stop.color} ${stop.location * 100}%`)
    .join(",")})`;
};

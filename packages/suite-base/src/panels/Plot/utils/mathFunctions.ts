// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { isQuaternion, quatToYpr, quatToYrp } from "@lichtblick/suite-base/util/quatToEuler";

import { getChartValue } from "./datum";

export type MathFunction = (arg: unknown) => number;

interface PlotMathFunctions {
  [key: string]: MathFunction;
  abs: MathFunction;
  negative: MathFunction;
  deg2rad: MathFunction;
  rad2deg: MathFunction;
  yaw: MathFunction;
  pitch: MathFunction;
  roll: MathFunction;
  ypr: MathFunction;
  yrp: MathFunction;
  norm: MathFunction;
}

export const mathFunctions: PlotMathFunctions = {
  abs: numericFunction(Math.abs),
  acos: numericFunction(Math.acos),
  asin: numericFunction(Math.asin),
  atan: numericFunction(Math.atan),
  ceil: numericFunction(Math.ceil),
  cos: numericFunction(Math.cos),
  log: numericFunction(Math.log),
  log1p: numericFunction(Math.log1p),
  log2: numericFunction(Math.log2),
  log10: numericFunction(Math.log10),
  round: numericFunction(Math.round),
  sign: numericFunction(Math.sign),
  sin: numericFunction(Math.sin),
  sqrt: numericFunction(Math.sqrt),
  tan: numericFunction(Math.tan),
  trunc: numericFunction(Math.trunc),
  negative: numericFunction((value) => -value),
  deg2rad: numericFunction((value) => value * (Math.PI / 180)),
  rad2deg: numericFunction((value) => value * (180 / Math.PI)),
  yaw: (value) => {
    if (!isQuaternion(value)) {
      return NaN;
    }
    const [yaw] = quatToYpr(value.x, value.y, value.z, value.w);
    return yaw;
  },

  pitch: (value) => {
    if (!isQuaternion(value)) {
      return NaN;
    }
    const [, pitch] = quatToYpr(value.x, value.y, value.z, value.w);
    return pitch;
  },

  roll: (value) => {
    if (!isQuaternion(value)) {
      return NaN;
    }
    const [, , roll] = quatToYpr(value.x, value.y, value.z, value.w);
    return roll;
  },

  // Message-path modifiers return one scalar; both ordering variants return yaw.
  ypr: (value) => {
    if (!isQuaternion(value)) {
      return NaN;
    }
    const [yaw] = quatToYpr(value.x, value.y, value.z, value.w);
    return yaw;
  },

  yrp: (value) => {
    if (!isQuaternion(value)) {
      return NaN;
    }
    const [yaw] = quatToYrp(value.x, value.y, value.z, value.w);
    return yaw;
  },

  norm: (value) => {
    if (typeof value === "number") {
      return Math.abs(value);
    }
    if (Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView))) {
      return norm(Array.from(value as ArrayLike<unknown>));
    }
    if (typeof value === "object" && value != undefined) {
      const vector = value as Record<string, unknown>;
      const components = [vector.x, vector.y, vector.z, vector.w].filter(
        (component) => component != undefined,
      );
      return components.length >= 2 ? norm(components) : NaN;
    }
    return NaN;
  },
};

export function getMathFunction(modifier: string | undefined): MathFunction | undefined {
  return modifier ? mathFunctions[modifier] : undefined;
}

function numericFunction(fn: (value: number) => number): MathFunction {
  return (value) => {
    const chartValue = getChartValue(value);
    return chartValue == undefined ? NaN : fn(chartValue);
  };
}

function norm(values: readonly unknown[]): number {
  if (!values.every((value): value is number => typeof value === "number")) {
    return NaN;
  }
  return Math.hypot(...values);
}

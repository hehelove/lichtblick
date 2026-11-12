// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import {
  getMathFunction,
  mathFunctions,
} from "@lichtblick/suite-base/panels/Plot/utils/mathFunctions";
import { BasicBuilder } from "@lichtblick/test-builders";

describe("mathFunctions", () => {
  it("should correctly calculate the negative of a number", () => {
    const positiveNumber = BasicBuilder.number();
    const negativeNumber = positiveNumber * -1;

    expect(mathFunctions.negative(positiveNumber)).toBe(negativeNumber);
    expect(mathFunctions.negative(negativeNumber)).toBe(positiveNumber);
    expect(mathFunctions.negative(0)).toBe(-0);
  });

  it("should correctly convert degrees to radians", () => {
    expect(mathFunctions.deg2rad(0)).toBe(0);
    expect(mathFunctions.deg2rad(90)).toBeCloseTo(Math.PI / 2, 5);
    expect(mathFunctions.deg2rad(180)).toBeCloseTo(Math.PI, 5);
    expect(mathFunctions.deg2rad(360)).toBeCloseTo(2 * Math.PI, 5);
  });

  it("should correctly convert radians to degrees", () => {
    expect(mathFunctions.rad2deg(0)).toBe(0);
    expect(mathFunctions.rad2deg(Math.PI / 2)).toBeCloseTo(90, 5);
    expect(mathFunctions.rad2deg(Math.PI)).toBeCloseTo(180, 5);
    expect(mathFunctions.rad2deg(2 * Math.PI)).toBeCloseTo(360, 5);
  });

  it("calculates norms for arrays, typed arrays, and vector objects", () => {
    expect(mathFunctions.norm([3, 4])).toBe(5);
    expect(mathFunctions.norm(new Float32Array([2, 3, 6]))).toBe(7);
    expect(mathFunctions.norm({ x: 1, y: 2, z: 2 })).toBe(3);
    expect(mathFunctions.norm({ x: 1, y: 2, z: 2, w: 4 })).toBe(5);
  });

  it("returns NaN for invalid modifier inputs", () => {
    expect(mathFunctions.abs({ x: 1 })).toBeNaN();
    expect(mathFunctions.norm([3, "4"])).toBeNaN();
    expect(mathFunctions.norm({ x: 3 })).toBeNaN();
    expect(mathFunctions.yaw(0)).toBeNaN();
  });

  it("returns yaw from @ypr and @yrp", () => {
    const ypr = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.4, 0.6, "ZYX"));
    const yrp = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.2, 0.6, "ZXY"));

    expect(mathFunctions.ypr(ypr)).toBeCloseTo(THREE.MathUtils.radToDeg(0.6));
    expect(mathFunctions.yrp(yrp)).toBeCloseTo(THREE.MathUtils.radToDeg(0.6));
  });

  it("extracts quaternion components", () => {
    const yaw90 = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };

    expect(mathFunctions.yaw(yaw90)).toBeCloseTo(90);
    expect(mathFunctions.pitch(yaw90)).toBeCloseTo(0);
    expect(mathFunctions.roll(yaw90)).toBeCloseTo(0);
  });

  it("length returns array/typed-array lengths, NaN for non-arrays", () => {
    expect(getMathFunction("length")!([1, 2, 3])).toBe(3);
    expect(getMathFunction("length")!(new Float32Array(7))).toBe(7);
    expect(getMathFunction("length")!([])).toBe(0);
    expect(getMathFunction("length")!(42)).toBeNaN();
  });

  it("binds numeric operands; missing/zero operands follow JS semantics", () => {
    expect(getMathFunction("mul", 1e-9)!(5)).toBeCloseTo(5e-9);
    expect(getMathFunction("div", 0)!(5)).toBe(Infinity);
    expect(getMathFunction("add")!(5)).toBeNaN(); // no operand -> NaN
    expect(getMathFunction("add", 2)!(5)).toBe(7);
    expect(getMathFunction("sub", 2)!(5)).toBe(3);
    // Operands flow through getChartValue semantics for the *value*: numeric strings and bigints work.
    expect(getMathFunction("add", 2)!("5")).toBe(7);
    expect(getMathFunction("mul", 2)!(10n)).toBe(20);
  });

  it("does not register delta as a unary math function", () => {
    // delta is not a unary modifier; the timestamp datasets builder handles it.
    expect(getMathFunction("delta")).toBeUndefined();
    expect(getMathFunction("timedelta")).toBeUndefined();
  });
});

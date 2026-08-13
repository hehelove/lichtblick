// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler();

/**
 * Convert a quaternion to roll-pitch-yaw Euler angles (XYZ intrinsic order).
 * Returns [roll, pitch, yaw] in degrees.
 */
export function quatToEuler(
  x: number,
  y: number,
  z: number,
  w: number,
): [roll: number, pitch: number, yaw: number] {
  tempQuaternion.set(x, y, z, w);
  tempEuler.setFromQuaternion(tempQuaternion, "XYZ");
  return [
    THREE.MathUtils.radToDeg(tempEuler.x),
    THREE.MathUtils.radToDeg(tempEuler.y),
    THREE.MathUtils.radToDeg(tempEuler.z),
  ];
}

/**
 * Convert a quaternion to yaw-pitch-roll angles (ZYX intrinsic order).
 * Returns [yaw, pitch, roll] in degrees.
 * This is the standard aerospace convention: first yaw (Z), then pitch (Y), then roll (X).
 */
export function quatToYpr(
  x: number,
  y: number,
  z: number,
  w: number,
): [yaw: number, pitch: number, roll: number] {
  tempQuaternion.set(x, y, z, w);
  tempEuler.setFromQuaternion(tempQuaternion, "ZYX");
  return [
    THREE.MathUtils.radToDeg(tempEuler.z),
    THREE.MathUtils.radToDeg(tempEuler.y),
    THREE.MathUtils.radToDeg(tempEuler.x),
  ];
}

/**
 * Convert a quaternion to yaw-roll-pitch angles (ZXY intrinsic order).
 * Returns [yaw, roll, pitch] in degrees.
 */
export function quatToYrp(
  x: number,
  y: number,
  z: number,
  w: number,
): [yaw: number, roll: number, pitch: number] {
  tempQuaternion.set(x, y, z, w);
  tempEuler.setFromQuaternion(tempQuaternion, "ZXY");
  return [
    THREE.MathUtils.radToDeg(tempEuler.z),
    THREE.MathUtils.radToDeg(tempEuler.x),
    THREE.MathUtils.radToDeg(tempEuler.y),
  ];
}

/**
 * Check if a value looks like a quaternion object with x, y, z, w fields.
 */
export function isQuaternion(
  value: unknown,
): value is { x: number; y: number; z: number; w: number } {
  if (typeof value !== "object" || value == undefined) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.x === "number" &&
    typeof obj.y === "number" &&
    typeof obj.z === "number" &&
    typeof obj.w === "number"
  );
}

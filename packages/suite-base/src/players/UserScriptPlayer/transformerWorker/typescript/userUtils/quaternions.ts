// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export type Quaternion = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export type Euler = {
  roll: number;
  pitch: number;
  yaw: number;
};

/**
 * Converts a quaternion to a Euler roll, pitch, yaw representation, in degrees.
 *
 * @param quaternion Input quaternion.
 * @returns Converted Euler angle roll, pitch, yaw representation, in degrees.
 */
export function quaternionToEuler(quaternion: Quaternion): Euler {
  const { x, y, z, w } = quaternion;

  const toDegrees = 180 / Math.PI;
  const dcm00 = w * w + x * x - y * y - z * z;
  const dcm10 = 2 * (x * y + w * z);
  const dcm20 = 2 * (x * z - w * y);
  const dcm21 = 2 * (w * x + y * z);
  const dcm22 = w * w - x * x - y * y + z * z;
  const roll = toDegrees * Math.atan2(dcm21, dcm22);
  const pitch = toDegrees * Math.asin(-dcm20);
  const yaw = toDegrees * Math.atan2(dcm10, dcm00);
  return {
    roll,
    pitch,
    yaw,
  };
}

/**
 * Converts an Euler angle representation to a quaternion.
 *
 * Mirrors eulerToQuaternion from @lichtblick/suite-base/util/geometry; user
 * scripts cannot import suite-base modules so the implementation is inlined.
 *
 * @param euler Euler angles in radians; x is roll, y is pitch, z is yaw.
 * @returns Converted quaternion.
 */
export function eulerToQuaternion(euler: { x: number; y: number; z: number }): Quaternion {
  const roll = euler.x;
  const pitch = euler.y;
  const yaw = euler.z;

  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);

  const w = cy * cr * cp + sy * sr * sp;
  const x = cy * sr * cp - sy * cr * sp;
  const y = cy * cr * sp + sy * sr * cp;
  const z = sy * cr * cp - cy * sr * sp;

  return { x, y, z, w };
}

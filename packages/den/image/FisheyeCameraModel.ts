// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CameraInfo, ICameraModel } from "@lichtblick/suite";

type Vector2 = { x: number; y: number };

type Vector3 = { x: number; y: number; z: number };

/**
 * Hard cap on the ray angle θ used by {@link FisheyeCameraModel#projectPixelTo3dPlane}, so
 * `tan(θ)` stays finite. Without it the plane projection degenerates towards the edges of very
 * wide field-of-view images (θ→90° and beyond, where tan flips sign).
 */
const MAX_PLANE_THETA = (85 * Math.PI) / 180;

/**
 * A fisheye camera model that can be used to unproject pixel coordinates into 3D rays.
 *
 * Implements the Kannala-Brandt fisheye models used by `foxglove.CameraCalibration` /
 * `sensor_msgs/CameraInfo` distortion models `kannala_brandt` (OpenCV `cv::fisheye`; the ROS 2
 * name is `equidistant`) and `fisheye62` (Project Aria). See
 * <https://docs.opencv.org/4.x/db/d58/group__calib3d__fisheye.html> and
 * <https://facebookresearch.github.io/projectaria_tools/docs/tech_insights/camera_intrinsic_models>.
 *
 * Both models share the same radial polynomial in the angle θ from the optical axis,
 * `r_d = θ + D[0]θ³ + D[1]θ⁵ + D[2]θ⁷ + D[3]θ⁹`, and differ only in their coefficient layout:
 *
 * - `kannala_brandt` / `equidistant` / `kannala_brandt4`: `D = [k1, k2, k3, k4]`
 * - `fisheye62`: `D = [k0, k1, k2, k3, p0, p1, crit_theta?]` with tangential terms
 *   `t_x = p0(2u_r² + r_d²) + 2p1·u_r·v_r` and `t_y = p1(2v_r² + r_d²) + 2p0·u_r·v_r`, where
 *   `crit_theta` (radians) optionally bounds the viewable angle for plane projection.
 */
export class FisheyeCameraModel implements ICameraModel {
  /** The full camera image width in pixels. */
  public readonly width: number;
  /** The full camera image height in pixels. */
  public readonly height: number;

  public fx: number;
  public fy: number;
  public cx: number;
  public cy: number;

  /** Radial coefficients of θ³, θ⁵, θ⁷, θ⁹ (the θ term itself has coefficient 1). */
  #radial: [number, number, number, number];
  /** Tangential distortion coefficients (fisheye62 only; zero for kannala_brandt). */
  #p0: number;
  #p1: number;
  /** Upper bound on θ in plane projection: `min(crit_theta, 85°)`. */
  #planeThetaCap: number;
  /** Polar coordinates of the most recently unprojected pixel. */
  #theta: number;
  #phi: number;

  public constructor(info: CameraInfo) {
    const {
      binning_x,
      binning_y,
      roi,
      distortion_model: model,
      D,
      K,
      width,
      height,
    } = info;

    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid image size ${width}x${height}`);
    }
    if (K.length !== 9) {
      throw new Error(`K.length=${K.length}, expected 9`);
    }
    const fx = K[0] ?? 0;
    const fy = K[4] ?? 0;
    if (fx === 0 || fy === 0) {
      throw new Error(`Invalid focal length (fx=${fx}, fy=${fy})`);
    }
    const fisheye62 = model === "fisheye62";
    if (fisheye62 ? D.length !== 6 && D.length !== 7 : D.length !== 4) {
      throw new Error(
        `Invalid D.length=${D.length} for distortion_model "${model}", expected ${
          fisheye62 ? "6-7" : "4"
        }`,
      );
    }

    this.fx = fx;
    this.fy = fy;
    this.cx = K[2] ?? 0;
    this.cy = K[5] ?? 0;
    this.width = width;
    this.height = height;
    this.#radial = [D[0] ?? 0, D[1] ?? 0, D[2] ?? 0, D[3] ?? 0];
    this.#p0 = fisheye62 ? (D[4] ?? 0) : 0;
    this.#p1 = fisheye62 ? (D[5] ?? 0) : 0;
    this.#planeThetaCap =
      fisheye62 && D.length === 7
        ? Math.min(D[6] ?? Infinity, MAX_PLANE_THETA)
        : MAX_PLANE_THETA;

    // Binning = 0 is considered the same as binning = 1 (no binning).
    const binningX = binning_x !== 0 ? binning_x : 1;
    const binningY = binning_y !== 0 ? binning_y : 1;

    if (
      binningX > 1 ||
      binningY > 1 ||
      roi.x_offset !== 0 ||
      roi.y_offset !== 0
    ) {
      throw new Error(
        "Failed to initialize camera model: unable to handle adjusted binning and adjusted roi camera models.",
      );
    }

    this.#theta = 0;
    this.#phi = 0;
  }

  /**
   * Computes the polar coordinates (θ, φ) of the ray through `pixel`: θ is the angle from the
   * optical axis (+z) and φ = atan2(y, x) in the image plane.
   *
   * This inverts the non-linear forward projection with fixed-count iterative optimization, in the
   * style of `PinholeCameraModel.undistortNormalized`: the tangential terms are removed with
   * Jacobi fixed-point iteration (`u_r = x_d - t_x(u_r, v_r)`), then the odd radial polynomial is
   * inverted with Newton's method seeded with the equidistant guess θ = r_d. Note that these
   * methods are only locally convergent, requiring a good initial guess; they may not converge
   * for extreme values such as pixels far outside the calibrated field of view.
   */
  #unprojectPixel(pixel: Readonly<Vector2>): void {
    const x0 = (pixel.x - this.cx) / this.fx;
    const y0 = (pixel.y - this.cy) / this.fy;

    // Remove tangential distortion: x_d = u_r + t_x(u_r, v_r), y_d = v_r + t_y(u_r, v_r).
    const p0 = this.#p0;
    const p1 = this.#p1;
    let ux = x0;
    let uy = y0;
    for (let i = 0; i < 5; ++i) {
      const xx = ux * ux;
      const yy = uy * uy;
      const xy = ux * uy;
      const r2 = xx + yy;
      ux = x0 - (p0 * (2 * xx + r2) + 2 * p1 * xy);
      uy = y0 - (p1 * (2 * yy + r2) + 2 * p0 * xy);
    }

    const rd = Math.sqrt(ux * ux + uy * uy);
    this.#phi = Math.atan2(uy, ux);

    // Invert r_d = θ + c3θ³ + c5θ⁵ + c7θ⁷ + c9θ⁹ (Newton's method).
    const [c3, c5, c7, c9] = this.#radial;
    let theta = rd;
    for (let i = 0; i < 5; ++i) {
      const t2 = theta * theta;
      const t4 = t2 * t2;
      const t6 = t4 * t2;
      const t8 = t4 * t4;
      const f = theta * (1 + c3 * t2 + c5 * t4 + c7 * t6 + c9 * t8) - rd;
      const df = 1 + 3 * c3 * t2 + 5 * c5 * t4 + 7 * c7 * t6 + 9 * c9 * t8;
      theta -= f / df;
    }
    this.#theta = theta;
  }

  /**
   * Projects a 2D image pixel to a point on a plane in 3D world coordinates a unit distance
   * along the Z axis: `(tan(θ)cos(φ), tan(θ)sin(φ), 1)` with θ clamped to
   * `min(crit_theta, 85°)` so that `tan(θ)` stays finite.
   *
   * @param out - The output vector to receive the 3D point.
   * @param pixel - The 2D image pixel coordinate.
   * @returns `out`
   */
  public projectPixelTo3dPlane(
    out: Vector3,
    pixel: Readonly<Vector2>,
  ): Vector3 {
    this.#unprojectPixel(pixel);
    const r = Math.tan(Math.min(this.#theta, this.#planeThetaCap));
    out.x = r * Math.cos(this.#phi);
    out.y = r * Math.sin(this.#phi);
    out.z = 1;
    return out;
  }

  /**
   * Projects a 2D image pixel into a 3D ray in world coordinates:
   * `(sin(θ)cos(φ), sin(θ)sin(φ), cos(θ))`, a unit vector for any θ, so wide field-of-view
   * (even >180°) cameras project without clamping.
   *
   * @param out - The output vector to receive the 3D ray direction.
   * @param pixel - The 2D image pixel coordinate.
   * @returns `out`
   */
  public projectPixelTo3dRay(out: Vector3, pixel: Readonly<Vector2>): Vector3 {
    this.#unprojectPixel(pixel);
    const sinTheta = Math.sin(this.#theta);
    out.x = sinTheta * Math.cos(this.#phi);
    out.y = sinTheta * Math.sin(this.#phi);
    out.z = Math.cos(this.#theta);
    return out;
  }
}

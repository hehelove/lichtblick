// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CameraInfo } from "@lichtblick/suite";

import { FisheyeCameraModel } from "./FisheyeCameraModel";

const WIDTH = 640;
const HEIGHT = 480;
const FX = 400;
// fx != fy on purpose, to catch focal length index slips
const FY = 410;
const CX = 320;
const CY = 240;

function makeCameraInfo(
  distortionModel: string,
  D: number[],
  K?: number[],
): CameraInfo {
  return {
    D,
    // prettier-ignore
    K: K ?? [FX, 0, CX, 0, FY, CY, 0, 0, 1],
    R: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    // prettier-ignore
    P: [FX, 0, CX, 0, 0, FY, CY, 0, 0, 0, 1, 0],
    width: WIDTH,
    height: HEIGHT,
    binning_x: 0,
    binning_y: 0,
    distortion_model: distortionModel,
    roi: { x_offset: 0, y_offset: 0, do_rectify: false, height: 0, width: 0 },
  };
}

/**
 * Closed-form forward projection, from the OpenCV `cv::fisheye` model
 * <https://docs.opencv.org/4.x/db/d58/group__calib3d__fisheye.html> and the
 * Project Aria Fisheye62 model
 * <https://facebookresearch.github.io/projectaria_tools/docs/tech_insights/camera_intrinsic_models>:
 *
 * r_d = θ(1 + D[0]θ² + D[1]θ⁴ + D[2]θ⁶ + D[3]θ⁸) (radial, odd polynomial in θ)
 * u_r = r_d cos(φ), v_r = r_d sin(φ)
 * t_x = p0(2u_r² + r_d²) + 2p1·u_r·v_r, t_y = p1(2v_r² + r_d²) + 2p0·u_r·v_r (tangential)
 * u = fx(u_r + t_x) + cx, v = fy(v_r + t_y) + cy
 */
function forwardPixel(
  D: number[],
  theta: number,
  phi: number,
): { x: number; y: number } {
  const theta2 = theta * theta;
  const theta4 = theta2 * theta2;
  const theta6 = theta4 * theta2;
  const theta8 = theta4 * theta4;
  const rTheta =
    theta *
    (1 + D[0]! * theta2 + D[1]! * theta4 + D[2]! * theta6 + D[3]! * theta8);
  const ur = rTheta * Math.cos(phi);
  const vr = rTheta * Math.sin(phi);
  const ur2 = ur * ur;
  const vr2 = vr * vr;
  const r2 = ur2 + vr2;
  const p0 = D[4] ?? 0;
  const p1 = D[5] ?? 0;
  const tx = p0 * (2 * ur2 + r2) + 2 * p1 * ur * vr;
  const ty = p1 * (2 * vr2 + r2) + 2 * p0 * ur * vr;
  return { x: FX * (ur + tx) + CX, y: FY * (vr + ty) + CY };
}

// Example real-world-ish fisheye distortion parameters
const KANNALA_D = [0.0456, -0.0203, 0.0015, -0.0002];
const FISHEYE62_D = [0.0456, -0.0203, 0.0015, -0.0002, 0.002, -0.0015];

describe("FisheyeCameraModel", () => {
  const out = { x: 0, y: 0, z: 0 };

  it("zero coefficients give the equidistant model", () => {
    const model = new FisheyeCameraModel(
      makeCameraInfo("kannala_brandt", [0, 0, 0, 0]),
    );

    model.projectPixelTo3dRay(out, { x: CX, y: CY });
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(1);

    const theta = 0.5;
    model.projectPixelTo3dRay(out, { x: CX + FX * theta, y: CY });
    const angle = Math.atan2(Math.hypot(out.x, out.y), out.z);
    // r = theta, not the pinhole r = tan(theta) model
    expect(angle).toBeCloseTo(theta);
    expect(angle).not.toBeCloseTo(Math.atan(theta));
  });

  it("inverts closed-form forward projection over a pixel grid", () => {
    const model = new FisheyeCameraModel(
      makeCameraInfo("kannala_brandt", KANNALA_D),
    );

    for (const theta of [0.15, 0.4, 0.7, 1.0, 1.25, 1.4]) {
      for (const phi of [0, 0.5, 1.2, 2.0, 2.8, Math.PI, -0.9, -2.5]) {
        const pixel = forwardPixel(KANNALA_D, theta, phi);
        model.projectPixelTo3dRay(out, pixel);
        expect(Math.atan2(Math.hypot(out.x, out.y), out.z)).toBeCloseTo(
          theta,
          9,
        );
        expect(Math.atan2(out.y, out.x)).toBeCloseTo(phi, 9);
      }
    }
  });

  it("fisheye62 with tangential terms round-trips", () => {
    // D[6] = crit_theta is present but must not affect ray projection
    const model = new FisheyeCameraModel(
      makeCameraInfo("fisheye62", [...FISHEYE62_D, 1.5]),
    );

    for (const theta of [0.3, 0.8, 1.2, 1.4]) {
      for (const phi of [0, 0.9, 1.9, 2.9, -1.3, -2.7]) {
        const pixel = forwardPixel(FISHEYE62_D, theta, phi);
        model.projectPixelTo3dRay(out, pixel);
        expect(Math.atan2(Math.hypot(out.x, out.y), out.z)).toBeCloseTo(
          theta,
          9,
        );
        expect(Math.atan2(out.y, out.x)).toBeCloseTo(phi, 9);
      }
    }
  });

  it("plane projection equals ray scaled by 1/ray.z below the clamp", () => {
    // crit_theta (1.48 rad) is below the 85° hard cap and above all test angles
    const model = new FisheyeCameraModel(
      makeCameraInfo("fisheye62", [...FISHEYE62_D, 1.48]),
    );
    const ray = { x: 0, y: 0, z: 0 };

    for (const theta of [0.05, 0.3, 0.6, 0.9, 1.2]) {
      for (const phi of [0.3, 1.4, 2.5, -0.8]) {
        const pixel = forwardPixel(FISHEYE62_D, theta, phi);
        model.projectPixelTo3dRay(ray, pixel);
        model.projectPixelTo3dPlane(out, pixel);
        expect(out.x).toBeCloseTo(ray.x / ray.z, 9);
        expect(out.y).toBeCloseTo(ray.y / ray.z, 9);
        expect(out.z).toBeCloseTo(1, 9);
      }
    }
  });

  it("throws on malformed K like PinholeCameraModel", () => {
    expect(
      () =>
        new FisheyeCameraModel(
          makeCameraInfo("kannala_brandt", [0, 0, 0, 0], []),
        ),
    ).toThrow();
    expect(
      () =>
        new FisheyeCameraModel(
          makeCameraInfo(
            "kannala_brandt",
            [0, 0, 0, 0],
            [0, 0, CX, 0, FY, CY, 0, 0, 1],
          ),
        ),
    ).toThrow();
    expect(
      () =>
        new FisheyeCameraModel(
          makeCameraInfo(
            "kannala_brandt",
            [0, 0, 0, 0],
            [FX, 0, CX, 0, 0, CY, 0, 0, 1],
          ),
        ),
    ).toThrow();
  });

  it("throws on malformed D length", () => {
    expect(
      () => new FisheyeCameraModel(makeCameraInfo("kannala_brandt", [0, 0, 0])),
    ).toThrow();
    expect(
      () =>
        new FisheyeCameraModel(
          makeCameraInfo("kannala_brandt", new Array<number>(5).fill(0)),
        ),
    ).toThrow();
    expect(
      () =>
        new FisheyeCameraModel(
          makeCameraInfo("fisheye62", new Array<number>(5).fill(0)),
        ),
    ).toThrow();
    expect(
      () =>
        new FisheyeCameraModel(
          makeCameraInfo("fisheye62", new Array<number>(8).fill(0)),
        ),
    ).toThrow();
  });

  it("clamps theta beyond crit_theta in plane mode", () => {
    const model = new FisheyeCameraModel(
      makeCameraInfo("fisheye62", [0, 0, 0, 0, 0, 0, 0.6]),
    );

    // pixel at theta = 1 rad > crit_theta = 0.6
    model.projectPixelTo3dPlane(out, { x: CX + FX, y: CY });
    expect(out.x).toBeCloseTo(Math.tan(0.6));
    expect(out.y).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(1);

    // ray projection is not clamped
    model.projectPixelTo3dRay(out, { x: CX + FX, y: CY });
    expect(Math.atan2(Math.hypot(out.x, out.y), out.z)).toBeCloseTo(1);
  });

  it("clamps theta beyond the 85° hard cap in plane mode", () => {
    const model = new FisheyeCameraModel(
      makeCameraInfo(
        "kannala_brandt",
        [0, 0, 0, 0],
        [150, 0, CX, 0, 150, CY, 0, 0, 1],
      ),
    );

    // pixel at theta = 2.5 rad (143°); tan flips sign past 90°, output must stay finite and capped
    model.projectPixelTo3dPlane(out, { x: CX + 2.5 * 150, y: CY });
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(
      Math.tan((85 * Math.PI) / 180),
    );
    expect(out.z).toBeCloseTo(1);
  });
});

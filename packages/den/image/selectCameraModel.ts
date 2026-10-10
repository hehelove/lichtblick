// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  CameraInfo,
  CameraModelBuilder,
  ICameraModel,
} from "@lichtblick/suite";

import { FisheyeCameraModel } from "./FisheyeCameraModel";
import { PinholeCameraModel } from "./PinholeCameraModel";
import { CameraModelsMap } from "./types";

// Builtin fisheye camera models, consulted after extension-contributed models (so extensions can
// still override them) and before the pinhole fallback. `kannala_brandt` is the foxglove schema
// name, `equidistant` the ROS 2 sensor_msgs name, and `kannala_brandt4` a common alias for the
// same OpenCV `cv::fisheye` model; `fisheye62` is the Project Aria model.
const BUILTIN_FISHEYE_MODELS: ReadonlyMap<string, CameraModelBuilder> = new Map(
  [
    ["kannala_brandt", (info) => new FisheyeCameraModel(info)],
    ["equidistant", (info) => new FisheyeCameraModel(info)],
    ["kannala_brandt4", (info) => new FisheyeCameraModel(info)],
    ["fisheye62", (info) => new FisheyeCameraModel(info)],
  ],
);

export const selectCameraModel = (
  cameraInfo: CameraInfo,
  cameraModels: CameraModelsMap,
): ICameraModel => {
  const cameraModel = cameraModels.get(cameraInfo.distortion_model);
  if (cameraModel) {
    return cameraModel.modelBuilder(cameraInfo);
  }
  const builtinModel = BUILTIN_FISHEYE_MODELS.get(cameraInfo.distortion_model);
  if (builtinModel) {
    return builtinModel(cameraInfo);
  }
  return new PinholeCameraModel(cameraInfo);
};

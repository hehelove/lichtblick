// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { RegisterMessageConverterArgs, Time } from "@lichtblick/suite";

/**
 * Fields of a ROS `sensor_msgs/msg/CompressedImage` consumed by the converter. ROS messages
 * always carry a `header`; it is optional here so partially-typed sources still compile.
 */
export type RosCompressedImage = {
  format: string;
  data: Uint8Array;
  header?: { stamp?: Time; frame_id?: string };
};

/**
 * Built-in conversion of H.264-encoded `sensor_msgs/msg/CompressedImage` messages to
 * `foxglove.CompressedVideo` so the image pipelines can decode them via WebCodecs, matching
 * Foxglove's built-in behavior.
 *
 * Non-h264 payloads (e.g. jpeg/png) return undefined, which leaves the message untouched for
 * panels that render CompressedImage natively.
 */
export const h264CompressedImageConverter: RegisterMessageConverterArgs<RosCompressedImage> = {
  type: "schema",
  fromSchemaName: "sensor_msgs/msg/CompressedImage",
  toSchemaName: "foxglove.CompressedVideo",
  converter: (msg, event) => {
    if (msg.format !== "h264" && msg.format !== "avc1") {
      return undefined;
    }
    return {
      format: "h264",
      data: msg.data,
      // The video renderable keys decode ordering and TF frame matching off these fields; fall
      // back to the event receive time and an empty frame id when the ROS header is absent.
      timestamp: msg.header?.stamp ?? event.receiveTime,
      frame_id: msg.header?.frame_id ?? "",
      frame: undefined,
    };
  },
};

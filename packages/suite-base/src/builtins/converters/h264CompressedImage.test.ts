// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessageEvent } from "@lichtblick/suite";

import { h264CompressedImageConverter, RosCompressedImage } from "./h264CompressedImage";

function makeEvent(message: RosCompressedImage): MessageEvent<RosCompressedImage> {
  return {
    topic: "/camera/compressed",
    schemaName: "sensor_msgs/msg/CompressedImage",
    message,
    receiveTime: { sec: 99, nsec: 1 },
    sizeInBytes: message.data.byteLength,
  };
}

describe("h264CompressedImageConverter", () => {
  it("converts from sensor_msgs/msg/CompressedImage to foxglove.CompressedVideo", () => {
    expect(h264CompressedImageConverter.fromSchemaName).toBe("sensor_msgs/msg/CompressedImage");
    expect(h264CompressedImageConverter.toSchemaName).toBe("foxglove.CompressedVideo");
  });

  it.each(["h264", "avc1"])("maps %s CompressedImage to an h264 CompressedVideo", (format) => {
    const data = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65, 0x88]);
    const stamp = { sec: 12, nsec: 345 };
    const message: RosCompressedImage = {
      format,
      data,
      header: { stamp, frame_id: "camera_optical_frame" },
    };

    expect(h264CompressedImageConverter.converter(message, makeEvent(message))).toEqual({
      format: "h264",
      data,
      timestamp: stamp,
      frame_id: "camera_optical_frame",
      frame: undefined,
    });
  });

  it.each(["jpeg", "png"])(
    "returns undefined for %s so panels render the original CompressedImage",
    (format) => {
      const message: RosCompressedImage = { format, data: new Uint8Array([1, 2, 3]) };

      expect(h264CompressedImageConverter.converter(message, makeEvent(message))).toBeUndefined();
    },
  );

  it("falls back to the event receive time when the header is missing", () => {
    const data = new Uint8Array([1]);
    const message: RosCompressedImage = { format: "h264", data };

    expect(h264CompressedImageConverter.converter(message, makeEvent(message))).toMatchObject({
      format: "h264",
      data,
      timestamp: { sec: 99, nsec: 1 },
      frame_id: "",
    });
  });
});

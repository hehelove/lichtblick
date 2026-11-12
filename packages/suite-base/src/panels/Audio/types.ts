// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@lichtblick/suite";
import {
  COMPRESSED_AUDIO_DATATYPES,
  RAW_AUDIO_DATATYPES,
} from "@lichtblick/suite-base/util/foxgloveSchemas";

/**
 * Vendored message shapes rather than a @foxglove/schemas 2.x upgrade: the pinned
 * @foxglove/schemas@1.13.0 has RawAudio but no CompressedAudio.
 */
export type RawAudioLike = {
  timestamp: Time;
  data: Uint8Array;
  format: string;
  sample_rate: number;
  number_of_channels: number;
};

export type CompressedAudioLike = {
  timestamp: Time;
  data: Uint8Array;
  format: string;
};

export type AudioConfig = {
  topicToRender?: string;
  volume?: number;
};

/** All schema names (ROS1/ROS2/IDL variations included) the Audio panel can consume. */
export const SUPPORTED_DATATYPES = new Set<string>([
  ...RAW_AUDIO_DATATYPES,
  ...COMPRESSED_AUDIO_DATATYPES,
]);

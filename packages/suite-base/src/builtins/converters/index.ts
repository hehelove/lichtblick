// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { RegisterMessageConverterArgs } from "@lichtblick/suite";

import { h264CompressedImageConverter } from "./h264CompressedImage";

/**
 * Message converters that ship with the app and are available without installing any extension.
 * Seeded into the extension catalog; extension converters still take priority when both can
 * serve a subscription (collateTopicSchemaConversions prefers namespaced converters).
 */
export const builtinMessageConverters: RegisterMessageConverterArgs<unknown>[] = [
  // Src-type erasure cast, mirroring buildContributionPoints' handling of extension converters.
  h264CompressedImageConverter as RegisterMessageConverterArgs<unknown>,
];

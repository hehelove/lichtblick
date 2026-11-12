// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

export const videoExport = {
  title: "Export video",
  buttonTitle: "Export video",
  panel: "Panel",
  noPanels:
    "No recordable panels are open. 3D and Image panels support video export.",
  frameRate: "Frame rate",
  range: "Range",
  outputSize: "Approximate output size",
  start: "Start",
  stop: "Stop",
  close: "Close",
  recording: "Recording “{{title}}” at {{fps}} fps…",
  note: "The export runs in real time at 1x playback speed. Interactions with the panel are captured.",
  unsupportedBrowser: "Video export is not supported in this browser.",
  liveSourceRequired:
    "Video export needs a data source with a playback range (not a live source).",
  playerNotReady: "Waiting for a data source…",
};

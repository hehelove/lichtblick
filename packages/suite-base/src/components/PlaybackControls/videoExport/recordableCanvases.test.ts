/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { act, renderHook } from "@testing-library/react";

import {
  getRecordableCanvases,
  registerRecordableCanvas,
  subscribeRecordableCanvases,
  useRecordableCanvases,
} from "./recordableCanvases";

describe("recordableCanvases registry", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
  });

  it("registers an entry and returns an unregister function", () => {
    const canvas = document.createElement("canvas");
    const listener = jest.fn();
    const unsubscribe = subscribeRecordableCanvases(listener);
    cleanups.push(unsubscribe);

    const unregister = registerRecordableCanvas("panel-1", {
      canvas,
      title: "3D",
    });
    cleanups.push(unregister);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getRecordableCanvases()).toEqual([
      { id: "panel-1", canvas, title: "3D" },
    ]);

    unregister();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getRecordableCanvases()).toEqual([]);
  });

  it("a stale unregister does not remove a newer registration of the same id", () => {
    const canvas1 = document.createElement("canvas");
    const canvas2 = document.createElement("canvas");

    const unregisterFirst = registerRecordableCanvas("panel-1", {
      canvas: canvas1,
      title: "3D",
    });
    cleanups.push(unregisterFirst);
    const unregisterSecond = registerRecordableCanvas("panel-1", {
      canvas: canvas2,
      title: "3D",
    });
    cleanups.push(unregisterSecond);

    // the first registration was replaced, so its cleanup must be a no-op
    unregisterFirst();
    expect(getRecordableCanvases()).toEqual([
      { id: "panel-1", canvas: canvas2, title: "3D" },
    ]);
  });

  it("subscribers stop receiving events after unsubscribing", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeRecordableCanvases(listener);
    cleanups.push(unsubscribe);

    const unregister = registerRecordableCanvas("panel-1", {
      canvas: document.createElement("canvas"),
      title: "3D",
    });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    unregister();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("useRecordableCanvases reflects the current set of entries", () => {
    const { result } = renderHook(() => useRecordableCanvases());
    expect(result.current).toEqual([]);

    const canvas = document.createElement("canvas");
    act(() => {
      const unregister = registerRecordableCanvas("panel-1", {
        canvas,
        title: "Image",
      });
      cleanups.push(unregister);
    });
    expect(result.current).toEqual([{ id: "panel-1", canvas, title: "Image" }]);

    act(() => {
      cleanups.splice(0).forEach((cleanup) => {
        cleanup();
      });
    });
    expect(result.current).toEqual([]);
  });
});

/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { createCanvasRecorder, pickVideoMimeType } from "./canvasRecorder";

class FakeMediaRecorder {
  public static instances: FakeMediaRecorder[] = [];
  public static isTypeSupported = jest.fn((_mimeType: string) => true);

  public stream: MediaStream;
  public options: MediaRecorderOptions | undefined;
  public state: "inactive" | "recording" = "inactive";
  public ondataavailable?: (event: { data: Blob }) => void;
  public onstop?: () => void;
  public onerror?: (event: Event) => void;

  public constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    this.stream = stream;
    this.options = options;
    FakeMediaRecorder.instances.push(this);
  }

  public start(): void {
    this.state = "recording";
  }

  public stop(): void {
    this.state = "inactive";
    this.onstop?.();
  }

  public emitChunk(blob: Blob): void {
    this.ondataavailable?.({ data: blob });
  }
}

describe("pickVideoMimeType", () => {
  const originalMediaRecorder = global.MediaRecorder;

  beforeEach(() => {
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.isTypeSupported = jest.fn((_mimeType: string) => true);
    global.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      value: () => ({ getVideoTracks: () => [] }) as unknown as MediaStream,
      configurable: true,
    });
  });

  afterEach(() => {
    global.MediaRecorder = originalMediaRecorder;
    delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>)
      .captureStream;
  });

  it("picks vp9 when everything is supported", () => {
    expect(pickVideoMimeType()).toBe("video/webm;codecs=vp9");
  });

  it("falls back through the chain per isTypeSupported", () => {
    FakeMediaRecorder.isTypeSupported = jest.fn(
      (mimeType: string) => mimeType === "video/webm;codecs=vp8",
    );
    expect(pickVideoMimeType()).toBe("video/webm;codecs=vp8");

    FakeMediaRecorder.isTypeSupported = jest.fn(
      (mimeType: string) => mimeType === "video/webm",
    );
    expect(pickVideoMimeType()).toBe("video/webm");

    FakeMediaRecorder.isTypeSupported = jest.fn(
      (mimeType: string) => mimeType === "video/mp4;codecs=avc1",
    );
    expect(pickVideoMimeType()).toBe("video/mp4;codecs=avc1");
  });

  it("returns undefined when nothing is supported", () => {
    FakeMediaRecorder.isTypeSupported = jest.fn((_mimeType: string) => false);
    expect(pickVideoMimeType()).toBeUndefined();
  });

  it("returns undefined when MediaRecorder is missing", () => {
    (global as { MediaRecorder?: unknown }).MediaRecorder = undefined;
    expect(pickVideoMimeType()).toBeUndefined();
  });
});

describe("createCanvasRecorder", () => {
  const originalMediaRecorder = global.MediaRecorder;

  beforeEach(() => {
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.isTypeSupported = jest.fn((_mimeType: string) => true);
    global.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      value: jest.fn(
        () => ({ getVideoTracks: () => [] }) as unknown as MediaStream,
      ),
      configurable: true,
    });
  });

  afterEach(() => {
    global.MediaRecorder = originalMediaRecorder;
    delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>)
      .captureStream;
  });

  it("captures the canvas at the requested fps and mimeType", () => {
    const canvas = document.createElement("canvas");
    const recorder = createCanvasRecorder(canvas, {
      fps: 30,
      mimeType: "video/webm;codecs=vp9",
    });
    recorder.start();
    expect(
      (HTMLCanvasElement.prototype.captureStream as jest.Mock).mock.calls,
    ).toEqual([[30]]);
    expect(FakeMediaRecorder.instances[0]?.options).toEqual({
      mimeType: "video/webm;codecs=vp9",
    });
    expect(FakeMediaRecorder.instances[0]?.state).toBe("recording");
  });

  it("assembles chunks into a blob on stop", async () => {
    const canvas = document.createElement("canvas");
    const rec = createCanvasRecorder(canvas, {
      fps: 30,
      mimeType: "video/webm;codecs=vp9",
    });
    rec.start();
    const fakeRecorder = FakeMediaRecorder.instances[0]!;
    fakeRecorder.emitChunk(new Blob(["a"]));
    fakeRecorder.emitChunk(new Blob(["b"]));

    const { blob, mimeType } = await rec.stop();
    expect(blob.size).toBe(2);
    expect(mimeType).toBe("video/webm;codecs=vp9");
  });

  it("resolves with an empty blob when stopped before it was started", async () => {
    const canvas = document.createElement("canvas");
    const rec = createCanvasRecorder(canvas, {
      fps: 30,
      mimeType: "video/webm;codecs=vp9",
    });

    const { blob, mimeType } = await rec.stop();
    expect(blob.size).toBe(0);
    expect(mimeType).toBe("video/webm;codecs=vp9");
  });

  it("resolves via the watchdog with captured chunks when onstop never fires", async () => {
    jest.useFakeTimers();
    try {
      const canvas = document.createElement("canvas");
      const rec = createCanvasRecorder(canvas, {
        fps: 30,
        mimeType: "video/webm;codecs=vp9",
      });
      rec.start();
      const fakeRecorder = FakeMediaRecorder.instances[0]!;
      fakeRecorder.emitChunk(new Blob(["x"]));
      fakeRecorder.stop = () => {
        fakeRecorder.state = "inactive"; // deliberately never calls onstop
      };

      const pending = rec.stop().then(({ blob }) => {
        expect(blob.size).toBe(1);
      });
      await jest.advanceTimersByTimeAsync(5000);
      await pending;
    } finally {
      jest.useRealTimers();
    }
  });

  it("resolves when stop() throws because the recorder is already inactive", async () => {
    const canvas = document.createElement("canvas");
    const rec = createCanvasRecorder(canvas, {
      fps: 30,
      mimeType: "video/webm;codecs=vp9",
    });
    rec.start();
    const fakeRecorder = FakeMediaRecorder.instances[0]!;
    fakeRecorder.emitChunk(new Blob(["x"]));
    fakeRecorder.stop = () => {
      throw new Error("InvalidStateError");
    };

    const { blob } = await rec.stop();
    expect(blob.size).toBe(1);
  });
});

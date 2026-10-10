/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { act, fireEvent, render, within } from "@testing-library/react";
import { StoreApi, createStore } from "zustand";

import MockMessagePipelineProvider from "@lichtblick/suite-base/components/MessagePipeline/MockMessagePipelineProvider";
import {
  WorkspaceContext,
  WorkspaceContextStore,
} from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";
import { downloadFiles } from "@lichtblick/suite-base/util/download";

import { VideoExportAdapter, finishVideoExport } from "./VideoExportAdapter";
import { VideoExportDialog, canStartVideoExport } from "./VideoExportDialog";
import { registerRecordableCanvas } from "./videoExport/recordableCanvases";

jest.mock("@lichtblick/suite-base/util/download", () => ({
  downloadFiles: jest.fn(),
  downloadTextFile: jest.fn(),
}));

jest.mock("@lichtblick/suite-base/context/PlayerSelectionContext", () => ({
  usePlayerSelection: jest.fn().mockReturnValue({ availableSources: [] }),
}));

jest.mock("@lichtblick/suite-base/context/Workspace/useOpenFile", () => ({
  useOpenFile: jest.fn().mockReturnValue(jest.fn()),
}));

class FakeMediaRecorder {
  public static instances: FakeMediaRecorder[] = [];
  public static isTypeSupported = jest.fn(() => true);

  public state: "inactive" | "recording" = "inactive";
  public ondataavailable?: (event: { data: Blob }) => void;
  public onstop?: () => void;

  public constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {
    FakeMediaRecorder.instances.push(this);
  }

  public stop(): void {
    this.state = "inactive";
    this.onstop?.();
  }

  public start(): void {
    this.state = "recording";
  }

  public emitChunk(blob: Blob): void {
    this.ondataavailable?.({ data: blob });
  }
}

function makeWorkspaceStore(initialRepeat: {
  value: boolean;
}): StoreApi<WorkspaceContextStore> {
  return createStore<WorkspaceContextStore>()(() => ({
    dialogs: {
      commandPalette: { open: false },
      dataSource: { activeDataSource: undefined, item: undefined, open: false },
      preferences: { initialTab: undefined, open: false },
    },
    featureTours: { active: undefined, shown: [] },
    layoutBrowser: { expandedSections: { personal: true, shared: true } },
    playbackControls: { repeat: initialRepeat.value, syncInstances: false },
    sidebars: {
      left: { item: "panel-settings", open: true, size: undefined },
      right: { item: undefined, open: false, size: undefined },
    },
  }));
}

type PipelineProps = React.ComponentProps<typeof MockMessagePipelineProvider>;

function setup(
  pipelineProps: Partial<PipelineProps> = {},
  initialRepeat: { value: boolean } = { value: true },
) {
  const workspaceStore = makeWorkspaceStore(initialRepeat);
  const canvas = document.createElement("canvas");

  const unregister = registerRecordableCanvas("panel-1", {
    canvas,
    title: "3D",
  });

  const utils = render(
    <WorkspaceContext.Provider value={workspaceStore}>
      <MockMessagePipelineProvider
        capabilities={["playbackControl"]}
        presence={PlayerPresence.PRESENT}
        startTime={{ sec: 0, nsec: 0 }}
        endTime={{ sec: 10, nsec: 0 }}
        currentTime={{ sec: 5, nsec: 0 }}
        isPlaying={false}
        {...pipelineProps}
      >
        <VideoExportAdapter />
        <VideoExportDialog onClose={jest.fn()} />
      </MockMessagePipelineProvider>
    </WorkspaceContext.Provider>,
  );

  return {
    ...utils,
    canvas,
    workspaceStore,
    unregister,
    // MUI Dialog renders into a portal outside the render container
    startButton: () =>
      within(document.body).getByRole("button", { name: "Start" }),
    stopButton: () =>
      within(document.body).getByRole("button", { name: "Stop" }),
  };
}

describe("canStartVideoExport", () => {
  it("requires codec support, playUntil (non-live), an present player and a canvas", () => {
    const yes = {
      mimeType: "video/webm",
      hasPlayUntil: true,
      presence: PlayerPresence.PRESENT,
      hasCanvas: true,
    };
    expect(canStartVideoExport(yes)).toBe(true);
    expect(canStartVideoExport({ ...yes, mimeType: undefined })).toBe(false);
    expect(canStartVideoExport({ ...yes, hasPlayUntil: false })).toBe(false);
    expect(
      canStartVideoExport({ ...yes, presence: PlayerPresence.ERROR }),
    ).toBe(false);
    expect(canStartVideoExport({ ...yes, hasCanvas: false })).toBe(false);
  });
});

describe("VideoExportDialog + VideoExportAdapter", () => {
  const originalMediaRecorder = global.MediaRecorder;

  beforeEach(() => {
    jest.clearAllMocks();
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.isTypeSupported = jest.fn(() => true);
    global.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      value: () => ({ getVideoTracks: () => [] }) as unknown as MediaStream,
      configurable: true,
    });
  });

  afterEach(async () => {
    global.MediaRecorder = originalMediaRecorder;
    delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>)
      .captureStream;
    // make sure a failed test cannot leak an active session into the next one
    await act(async () => {
      await finishVideoExport({
        pausePlayback: undefined,
        setPlaybackSpeed: undefined,
        setRepeat: () => {},
      });
    });
  });

  it("exports the selected canvas when playback passes the end of the range", async () => {
    const startPlayback = jest.fn();
    const pausePlayback = jest.fn();
    const seekPlayback = jest.fn();
    const utils = setup(
      { startPlayback, pausePlayback, seekPlayback },
      { value: true },
    );

    // Start the export: forces 1x + repeat off + seeks back to the range start.
    await act(async () => {
      fireEvent.click(utils.startButton());
    });
    expect(seekPlayback).toHaveBeenCalledWith({ sec: 0, nsec: 0 });
    expect(utils.workspaceStore.getState().playbackControls.repeat).toBe(false);
    // once a session is active the dialog switches to the recording view
    expect(() => utils.stopButton()).not.toThrow();

    // The seek landed at the range start: the recorder arms and playback resumes.
    await act(async () => {
      utils.rerender(
        <WorkspaceContext.Provider value={utils.workspaceStore}>
          <MockMessagePipelineProvider
            capabilities={["playbackControl"]}
            presence={PlayerPresence.PRESENT}
            startTime={{ sec: 0, nsec: 0 }}
            endTime={{ sec: 10, nsec: 0 }}
            currentTime={{ sec: 0, nsec: 0 }}
            isPlaying
            startPlayback={startPlayback}
            pausePlayback={pausePlayback}
            seekPlayback={seekPlayback}
          >
            <VideoExportAdapter />
            <VideoExportDialog onClose={jest.fn()} />
          </MockMessagePipelineProvider>
        </WorkspaceContext.Provider>,
      );
    });
    expect(FakeMediaRecorder.instances[0]?.state).toBe("recording");
    expect(startPlayback).toHaveBeenCalled();
    FakeMediaRecorder.instances[0]?.emitChunk(new Blob(["x"]));

    // Playback reaches the end: pause, save the blob, restore repeat.
    await act(async () => {
      utils.rerender(
        <WorkspaceContext.Provider value={utils.workspaceStore}>
          <MockMessagePipelineProvider
            capabilities={["playbackControl"]}
            presence={PlayerPresence.PRESENT}
            startTime={{ sec: 0, nsec: 0 }}
            endTime={{ sec: 10, nsec: 0 }}
            currentTime={{ sec: 10, nsec: 0 }}
            isPlaying
            startPlayback={startPlayback}
            pausePlayback={pausePlayback}
            seekPlayback={seekPlayback}
          >
            <VideoExportAdapter />
            <VideoExportDialog onClose={jest.fn()} />
          </MockMessagePipelineProvider>
        </WorkspaceContext.Provider>,
      );
    });
    expect(pausePlayback).toHaveBeenCalled();
    expect(downloadFiles).toHaveBeenCalledWith([
      {
        blob: expect.any(Blob),
        fileName: "lichtblick-export-0-10.webm",
      },
    ]);
    expect(utils.workspaceStore.getState().playbackControls.repeat).toBe(true);
    expect(utils.startButton().hasAttribute("disabled")).toBe(false);

    await act(async () => {
      utils.unregister();
    });
  });

  it("finishes the export when the recorded canvas is unregistered", async () => {
    const pausePlayback = jest.fn();
    const utils = setup({ pausePlayback });

    await act(async () => {
      fireEvent.click(utils.startButton());
    });
    await act(async () => {
      utils.rerender(
        <WorkspaceContext.Provider value={utils.workspaceStore}>
          <MockMessagePipelineProvider
            capabilities={["playbackControl"]}
            presence={PlayerPresence.PRESENT}
            startTime={{ sec: 0, nsec: 0 }}
            endTime={{ sec: 10, nsec: 0 }}
            currentTime={{ sec: 0, nsec: 0 }}
            isPlaying
            pausePlayback={pausePlayback}
          >
            <VideoExportAdapter />
            <VideoExportDialog onClose={jest.fn()} />
          </MockMessagePipelineProvider>
        </WorkspaceContext.Provider>,
      );
    });
    expect(FakeMediaRecorder.instances[0]?.state).toBe("recording");

    await act(async () => {
      utils.unregister();
    });
    expect(pausePlayback).toHaveBeenCalled();
    expect(downloadFiles).toHaveBeenCalled();
  });

  it("disables Start when presence is ERROR", () => {
    const utils = setup({ presence: PlayerPresence.ERROR });
    expect(utils.startButton().hasAttribute("disabled")).toBe(true);
    act(() => {
      utils.unregister();
    });
  });

  it("disables Start when MediaRecorder is unavailable (jsdom without stubs)", () => {
    (global as { MediaRecorder?: unknown }).MediaRecorder = undefined;
    const utils = setup();
    expect(utils.startButton().hasAttribute("disabled")).toBe(true);
    act(() => {
      utils.unregister();
    });
  });
});

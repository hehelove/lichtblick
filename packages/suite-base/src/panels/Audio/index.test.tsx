/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import { AudioCoordinator } from "./AudioCoordinator";
import AudioPanelExport from "./index";
import { buildSettingsTree } from "./settings";

// Shared mock instances; read lazily (at render/click time) so jest module
// factory hoisting does not hit them before initialization.
const mockSeekPlayback = jest.fn();
const mockUpdatePanelSettingsTree = jest.fn();
let mockCoordinator: {
  setBuffers: jest.Mock;
  sync: jest.Mock;
  setVolume: jest.Mock;
  resume: jest.Mock;
  dispose: jest.Mock;
};

function audioMessage(format: string): unknown {
  return {
    topic: "/audio",
    schemaName: "foxglove.RawAudio",
    receiveTime: { sec: 10, nsec: 0 },
    sizeInBytes: 4,
    message: {
      timestamp: { sec: 10, nsec: 5 },
      format,
      sample_rate: 8000,
      number_of_channels: 1,
      data: Uint8Array.from([0x01, 0x00, 0xff, 0x7f]),
    },
  };
}

let mockMessages: unknown[] = [audioMessage("pcm-s16")];
let mockTopics: { name: string; schemaName: string }[] = [
  { name: "/audio", schemaName: "foxglove.RawAudio" },
  { name: "/compressed_audio", schemaName: "foxglove.CompressedAudio" },
  { name: "/video", schemaName: "foxglove.CompressedVideo" },
];

const mockActiveData = {
  currentTime: { sec: 0, nsec: 0 },
  isPlaying: false,
  speed: 1,
};
const mockPipeline = () => ({
  playerState: { activeData: mockActiveData },
  seekPlayback: mockSeekPlayback,
});

jest.mock("@lichtblick/suite-base/components/Panel", () => ({
  __esModule: true,
  default: (Component: React.ComponentType) => Component,
}));
jest.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  useMessagePipeline: (selector: (ctx: unknown) => unknown) =>
    selector(mockPipeline()),
  useMessagePipelineGetter: () => () => mockPipeline(),
}));
jest.mock("@lichtblick/suite-base/PanelAPI", () => ({
  useDataSourceInfo: () => ({ topics: mockTopics }),
  useMessagesByTopic: () => ({ "/audio": mockMessages }),
}));
jest.mock("@lichtblick/suite-base/components/PanelExtensionAdapter", () => ({
  useSubscribeMessageRange: () => () => () => {},
}));
jest.mock("@lichtblick/suite-base/providers/PanelStateContextProvider", () => ({
  usePanelSettingsTreeUpdate: () => mockUpdatePanelSettingsTree,
}));
jest.mock("@lichtblick/suite-base/components/PanelToolbar", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-toolbar" />,
}));
jest.mock("./AudioCoordinator", () => ({
  AudioCoordinator: jest.fn().mockImplementation(() => mockCoordinator),
}));

const baseProps = { config: { volume: 0.5 }, saveConfig: jest.fn() };

describe("AudioPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMessages = [audioMessage("pcm-s16")];
    mockTopics = [
      { name: "/audio", schemaName: "foxglove.RawAudio" },
      { name: "/compressed_audio", schemaName: "foxglove.CompressedAudio" },
      { name: "/video", schemaName: "foxglove.CompressedVideo" },
    ];
    mockCoordinator = {
      setBuffers: jest.fn(),
      sync: jest.fn(),
      setVolume: jest.fn(),
      resume: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    mockSeekPlayback.mockClear();
  });

  it("renders the waveform container and seeks on click", () => {
    render(<AudioPanelExport {...baseProps} />);
    const waveform = screen.getByTestId("audio-waveform");
    expect(waveform).toBeTruthy();
    fireEvent.click(waveform);
    expect(mockSeekPlayback).toHaveBeenCalledWith({
      sec: expect.any(Number),
      nsec: expect.any(Number),
    });
  });

  it("builds the topic settings tree filtered by SUPPORTED_DATATYPES", () => {
    render(<AudioPanelExport {...baseProps} />);
    expect(mockUpdatePanelSettingsTree).toHaveBeenCalled();
    const { nodes } = mockUpdatePanelSettingsTree.mock.calls[
      mockUpdatePanelSettingsTree.mock.calls.length - 1
    ]![0] as {
      nodes: Record<string, { fields: Record<string, { options?: unknown }> }>;
    };
    const topicField = nodes.general!.fields.topicToRender!;
    expect(topicField.options).toEqual([
      { label: "/audio", value: "/audio" },
      { label: "/compressed_audio", value: "/compressed_audio" },
    ]);
  });

  it("applies settings updates to the config", () => {
    const saveConfig = jest.fn();
    const props = { config: { volume: 0.5 }, saveConfig };
    render(<AudioPanelExport {...props} />);
    const { actionHandler } = mockUpdatePanelSettingsTree.mock.calls[0]![0] as {
      actionHandler: (action: unknown) => void;
    };

    actionHandler({
      action: "update",
      payload: { path: ["general", "volume"], value: 0.8, input: "slider" },
    });
    expect(saveConfig).toHaveBeenCalledTimes(1);
    expect(
      saveConfig.mock.calls[0]![0]({ volume: 0.5, topicToRender: "/audio" }),
    ).toEqual({
      volume: 0.8,
      topicToRender: "/audio",
    });

    actionHandler({
      action: "update",
      payload: {
        path: ["general", "topicToRender"],
        value: "/compressed_audio",
        input: "select",
      },
    });
    expect(
      saveConfig.mock.calls[1]![0]({ volume: 0.5, topicToRender: "/audio" }),
    ).toEqual({ volume: 0.5, topicToRender: "/compressed_audio" });
  });

  it("shows an explicit unsupported message for g726 formats", () => {
    mockMessages = [audioMessage("g726-40")];
    render(<AudioPanelExport {...baseProps} />);
    expect(screen.getByText(/g726-40/)).toBeTruthy();
  });

  it("shows an empty state when no audio topic is available", () => {
    mockTopics = [];
    render(<AudioPanelExport {...baseProps} />);
    expect(screen.getByText("No audio topics available")).toBeTruthy();
    expect(screen.queryByTestId("audio-waveform")).toBeNull();
  });

  it("constructs the coordinator and syncs playback only after audio is enabled", () => {
    render(<AudioPanelExport {...baseProps} />);
    expect(AudioCoordinator).not.toHaveBeenCalled();
    expect(mockCoordinator.sync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Enable audio" }));
    expect(AudioCoordinator).toHaveBeenCalledTimes(1);
    expect(mockCoordinator.resume).toHaveBeenCalled();
    expect(mockCoordinator.setVolume).toHaveBeenCalledWith(0.5);
    expect(mockCoordinator.sync).toHaveBeenCalledWith({
      currentTime: { sec: 0, nsec: 0 },
      isPlaying: false,
      speed: 1,
    });
    expect(mockCoordinator.setBuffers).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          startSec: expect.any(Number),
          durationSec: expect.any(Number),
        }),
      ]),
    );
  });

  it("exports the panel with the Audio panel type and default config", () => {
    expect(AudioPanelExport.panelType).toBe("Audio");
    expect(AudioPanelExport.defaultConfig).toEqual({ volume: 0.5 });
  });
});

describe("buildSettingsTree", () => {
  const t = ((key: string, opts?: { topic?: string }) =>
    opts?.topic != undefined
      ? `${key} ${opts.topic}`
      : key) as unknown as Parameters<typeof buildSettingsTree>[3];

  it("keeps an unavailable topic selectable with an error", () => {
    const tree = buildSettingsTree(
      "/gone",
      0.5,
      [{ name: "/audio", schemaName: "foxglove.RawAudio" }],
      t,
    );
    const topicField = tree.general!.fields!.topicToRender! as {
      options?: unknown;
      error?: string;
    };
    expect(topicField.options).toEqual([
      { label: "/gone", value: "/gone" },
      { label: "/audio", value: "/audio" },
    ]);
    expect(topicField.error).toContain("/gone");
  });

  it("exposes the volume slider", () => {
    const tree = buildSettingsTree("/audio", 0.25, [], t);
    expect(tree.general!.fields!.volume!).toMatchObject({
      input: "slider",
      value: 0.25,
      min: 0,
      max: 1,
    });
  });
});

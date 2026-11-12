/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { setupJestCanvasMock } from "jest-canvas-mock";
import * as THREE from "three";

import { fromNanoSec } from "@lichtblick/rostime";
import { MessageEvent, SettingsTreeAction } from "@lichtblick/suite";
import { Asset } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { Renderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderer";
import { DEFAULT_SCENE_EXTENSION_CONFIG } from "@lichtblick/suite-base/panels/ThreeDeeRender/SceneExtensionConfig";
import { DEFAULT_CAMERA_STATE } from "@lichtblick/suite-base/panels/ThreeDeeRender/camera";
import { DEFAULT_PUBLISH_SETTINGS } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/PublishSettings";

import { RendererConfig } from "../IRenderer";
import { geodeticToENU, NavSatFixes } from "./NavSatFixes";

jest.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => "");

jest.mock("three", () => {
  const ActualTHREE = jest.requireActual("three");
  return {
    ...ActualTHREE,
    WebGLRenderer: function WebGLRenderer() {
      return {
        capabilities: {
          isWebGL2: true,
        },
        setPixelRatio: jest.fn(),
        setSize: jest.fn(),
        render: jest.fn(),
        clear: jest.fn(),
        setClearColor: jest.fn(),
        readRenderTargetPixels: jest.fn(),
        info: {
          reset: jest.fn(),
        },
        shadowMap: {},
        dispose: jest.fn(),
        clearDepth: jest.fn(),
        getDrawingBufferSize: () => ({ width: 100, height: 100 }),
      };
    },
  };
});

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: undefined,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
});

const defaultRendererConfig: RendererConfig = {
  cameraState: DEFAULT_CAMERA_STATE,
  followMode: "follow-pose",
  followTf: undefined,
  scene: {},
  transforms: {},
  topics: {},
  layers: {},
  publish: DEFAULT_PUBLISH_SETTINGS,
  imageMode: {},
};

const fetchAsset = async (
  uri: string,
  options?: { signal?: AbortSignal },
): Promise<Asset> => {
  const response = await fetch(uri, options);
  return {
    uri,
    data: new Uint8Array(await response.arrayBuffer()),
    mediaType: response.headers.get("content-type") ?? undefined,
  };
};

const defaultRendererProps = {
  config: defaultRendererConfig,
  interfaceMode: "3d" as const,
  fetchAsset,
  sceneExtensionConfig: DEFAULT_SCENE_EXTENSION_CONFIG,
  testOptions: {},
  customCameraModels: new Map(),
};

const GPS_TOPIC = "/gps";

type FixOptions = { status?: number; schemaName?: string };

// (latDeg, lonDeg, alt) — receiveTime and header stamp both derived from timeNs
function makeFixEvent(
  latDeg: number,
  lonDeg: number,
  alt: number,
  timeNs: bigint,
  opts: FixOptions = {},
): MessageEvent<Record<string, unknown>> {
  const stamp = fromNanoSec(timeNs);
  const schemaName = opts.schemaName ?? "sensor_msgs/NavSatFix";
  const isLocationFix = schemaName === "foxglove.LocationFix";
  return {
    topic: GPS_TOPIC,
    receiveTime: stamp,
    schemaName,
    message: isLocationFix
      ? {
          timestamp: stamp,
          frame_id: "gps",
          latitude: latDeg,
          longitude: lonDeg,
          altitude: alt,
        }
      : {
          header: { stamp, frame_id: "gps" },
          status: { status: opts.status ?? 0, service: 1 },
          latitude: latDeg,
          longitude: lonDeg,
          altitude: alt,
        },
    sizeInBytes: 0,
  };
}

function getExtension(renderer: Renderer): NavSatFixes {
  return renderer.sceneExtensions.get(NavSatFixes.extensionId) as NavSatFixes;
}

// The projected track vertices of the renderable for GPS_TOPIC
function trackPoints(
  renderer: Renderer,
): { x: number; y: number; z: number }[] {
  const renderable = getExtension(renderer).renderables.get(GPS_TOPIC)!;
  return renderable.userData.lineStrip!.userData.marker.points;
}

describe("geodeticToENU", () => {
  const out = new THREE.Vector3();

  it("produces zero displacement at the origin", () => {
    const result = geodeticToENU(out, 51.5, -0.1, 0, { lat: 51.5, lon: -0.1 });
    expect(result).toBe(out);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.z).toBe(0);
  });

  it("produces ~111,319 m northing for 1 degree latitude (R_e = 6,378,137 m)", () => {
    geodeticToENU(out, 52.5, -0.1, 0, { lat: 51.5, lon: -0.1 });
    expect(out.y).toBeCloseTo((6378137 * Math.PI) / 180, 0);
  });

  it("scales easting by cos(lat0)", () => {
    geodeticToENU(out, 60, 1, 0, { lat: 60, lon: 0 });
    expect(out.x).toBeCloseTo(
      ((6378137 * Math.PI) / 180) * Math.cos((60 * Math.PI) / 180),
      0,
    );
    expect(out.y).toBeCloseTo(0, 6);
  });

  it("preserves negative altitude", () => {
    geodeticToENU(out, 0, 0, -12.5, { lat: 0, lon: 0 });
    expect(out.z).toBe(-12.5);
  });
});

describe("NavSatFixes", () => {
  let canvas: HTMLCanvasElement;
  let parent: HTMLDivElement;
  let renderer: Renderer;

  beforeEach(() => {
    jest.clearAllMocks();
    setupJestCanvasMock();
    parent = document.createElement("div");
    canvas = document.createElement("canvas");
    parent.appendChild(canvas);
    renderer = new Renderer({ ...defaultRendererProps, canvas });
  });

  afterEach(() => {
    renderer.dispose();
    (console.warn as jest.Mock).mockClear();
  });

  it("accumulates fixes into one line strip anchored at the first fix", () => {
    renderer.addMessageEventBatch([
      makeFixEvent(0, 0, 0, 1n),
      makeFixEvent(0.001, 0.001, 5, 2n),
      makeFixEvent(0.002, 0, 5, 3n),
    ]);
    renderer.animationFrame();

    const extension = getExtension(renderer);
    expect(extension.renderables.size).toBe(1);
    const points = trackPoints(renderer);
    expect(points).toHaveLength(3);
    // Anchored at the first fix; flattenAltitude defaults to true so z stays 0
    expect(points[0]).toEqual({ x: 0, y: 0, z: 0 });
    // 0.001 deg latitude ≈ 111.3 m north of the anchor
    expect(points[1]!.y).toBeCloseTo(111.319, 0);
    expect(points[1]!.z).toBe(0);
  });

  it("skips no-fix and NaN events", () => {
    renderer.addMessageEventBatch([
      makeFixEvent(0, 0, 0, 1n),
      makeFixEvent(Number.NaN, 0, 0, 2n),
      makeFixEvent(0.001, 0, 0, 3n, { status: -1 }),
    ]);
    renderer.animationFrame();

    expect(trackPoints(renderer)).toHaveLength(1);
  });

  it("rebuilds after backward seek via handleSeek + handleAllFramesMessages", () => {
    const messages = [
      makeFixEvent(0, 0, 0, 1n),
      makeFixEvent(0.001, 0.001, 5, 2n),
      makeFixEvent(0.002, 0, 5, 3n),
    ];
    renderer.addMessageEventBatch(messages);
    renderer.animationFrame();
    expect(trackPoints(renderer)).toHaveLength(3);

    // Backward seek to t=2ns clears all renderables
    renderer.setCurrentTime(2n);
    renderer.handleSeek(3n);
    expect(getExtension(renderer).renderables.size).toBe(0);

    // Preloaded allFrames replay up to the seek target rebuilds the track
    expect(renderer.handleAllFramesMessages(messages)).toBe(true);
    renderer.animationFrame();
    const points = trackPoints(renderer);
    expect(points).toHaveLength(2);
    // Re-anchored at the first fix
    expect(points[0]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("handles foxglove.LocationFix identically", () => {
    renderer.addMessageEventBatch([
      makeFixEvent(0, 0, 0, 1n, { schemaName: "foxglove.LocationFix" }),
      makeFixEvent(0.001, 0.001, 5, 2n, { schemaName: "foxglove.LocationFix" }),
      makeFixEvent(0.002, 0, 5, 3n, { schemaName: "foxglove.LocationFix" }),
    ]);
    renderer.animationFrame();

    expect(getExtension(renderer).renderables.size).toBe(1);
    const points = trackPoints(renderer);
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(points[1]!.y).toBeCloseTo(111.319, 0);
  });

  it("shows settings node for NavSatFix topics with visible=false default", () => {
    renderer.setTopics([
      { name: GPS_TOPIC, schemaName: "sensor_msgs/NavSatFix" },
      { name: "/scan", schemaName: "sensor_msgs/LaserScan" },
    ]);

    const extension = getExtension(renderer);
    const entries = extension.settingsNodes();
    expect(entries).toHaveLength(1);
    const node = entries[0]!;
    expect(node.path).toEqual(["topics", GPS_TOPIC]);
    expect(node.node.visible).toBe(false);
    const fields = node.node.fields!;
    expect(fields["lineWidth"]).toBeDefined();
    expect(fields["gradient"]).toBeDefined();
    expect(fields["flattenAltitude"]).toBeDefined();

    // Toggling visibility persists into renderer.config.topics
    const action: SettingsTreeAction = {
      action: "update",
      payload: {
        path: ["topics", GPS_TOPIC, "visible"],
        value: true,
        input: "boolean",
      },
    };
    extension.handleSettingsAction(action);
    expect(renderer.config.topics[GPS_TOPIC]?.visible).toBe(true);
  });

  it("keeps altitude when flattenAltitude is disabled", () => {
    const extension = getExtension(renderer);
    extension.handleSettingsAction({
      action: "update",
      payload: {
        path: ["topics", GPS_TOPIC, "flattenAltitude"],
        value: false,
        input: "boolean",
      },
    });

    renderer.addMessageEventBatch([makeFixEvent(0, 0, -7, 1n)]);
    renderer.animationFrame();

    const points = trackPoints(renderer);
    expect(points).toHaveLength(1);
    expect(points[0]!.z).toBe(-7);
  });
});

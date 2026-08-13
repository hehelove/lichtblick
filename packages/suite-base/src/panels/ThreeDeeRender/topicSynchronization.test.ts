// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { RendererConfig } from "./IRenderer";
import { DEFAULT_CAMERA_STATE } from "./camera";
import { DEFAULT_PUBLISH_SETTINGS } from "./renderables/PublishSettings";
import { synchronizedTopics } from "./topicSynchronization";

function config(topics: RendererConfig["topics"]): RendererConfig {
  return {
    cameraState: DEFAULT_CAMERA_STATE,
    followMode: "follow-pose",
    followTf: undefined,
    scene: {},
    transforms: {},
    topics,
    topicsSynchronize: true,
    layers: {},
    publish: DEFAULT_PUBLISH_SETTINGS,
    imageMode: {},
  };
}

describe("synchronizedTopics", () => {
  it("requires the global setting and at least two visible opted-in topics", () => {
    const topics = [
      { name: "/a", schemaName: "test.Message" },
      { name: "/b", schemaName: "test.Message" },
    ];

    expect(
      synchronizedTopics(config({ "/a": { visible: true, synchronize: true } }), topics),
    ).toEqual(new Set());
    expect(
      synchronizedTopics(
        config({
          "/a": { visible: true, synchronize: true },
          "/b": { visible: true, synchronize: true },
        }),
        topics,
      ),
    ).toEqual(new Set(["/a", "/b"]));
  });

  it("excludes transform, JointState, and robot_description topics", () => {
    const topics = [
      { name: "/a", schemaName: "test.Message" },
      { name: "/b", schemaName: "test.Message" },
      { name: "/tf", schemaName: "tf2_msgs/TFMessage" },
      { name: "/robot_description", schemaName: "std_msgs/String" },
      { name: "/joint_states", schemaName: "sensor_msgs/JointState" },
    ];
    const topicConfig = Object.fromEntries(
      topics.map(({ name }) => [name, { visible: true, synchronize: true }]),
    );

    expect(synchronizedTopics(config(topicConfig), topics)).toEqual(new Set(["/a", "/b"]));
  });

  it("allows renderable std_msgs/String topics that are not URDF topics", () => {
    const topics = [
      { name: "/status_a", schemaName: "std_msgs/String" },
      { name: "/status_b", schemaName: "std_msgs/msg/String" },
    ];
    const topicConfig = Object.fromEntries(
      topics.map(({ name }) => [name, { visible: true, synchronize: true }]),
    );

    expect(synchronizedTopics(config(topicConfig), topics)).toEqual(
      new Set(["/status_a", "/status_b"]),
    );
  });

  it("is disabled in image interface mode", () => {
    const topics = [
      { name: "/a", schemaName: "test.Message" },
      { name: "/b", schemaName: "test.Message" },
    ];
    const topicConfig = {
      "/a": { visible: true, synchronize: true },
      "/b": { visible: true, synchronize: true },
    };

    expect(synchronizedTopics(config(topicConfig), topics, "image")).toEqual(new Set());
  });
});

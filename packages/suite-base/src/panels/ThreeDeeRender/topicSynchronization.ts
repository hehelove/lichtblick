// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Immutable, Topic } from "@lichtblick/suite";

import { RendererConfig } from "./IRenderer";
import { FRAME_TRANSFORM_DATATYPES, FRAME_TRANSFORMS_DATATYPES } from "./foxglove";
import { JOINTSTATE_DATATYPES, TF_DATATYPES, TRANSFORM_STAMPED_DATATYPES } from "./ros";
import { InterfaceMode } from "./types";

const URDF_TOPIC_SCHEMAS = new Set(["std_msgs/String", "std_msgs/msg/String"]);
const EXCLUDED_SCHEMAS = new Set([
  ...FRAME_TRANSFORM_DATATYPES,
  ...FRAME_TRANSFORMS_DATATYPES,
  ...TF_DATATYPES,
  ...TRANSFORM_STAMPED_DATATYPES,
  ...JOINTSTATE_DATATYPES,
]);

function isUrdfTopic(topic: Topic): boolean {
  return URDF_TOPIC_SCHEMAS.has(topic.schemaName) && /(^|\/)robot_description$/.test(topic.name);
}

export function synchronizedTopics(
  config: Immutable<RendererConfig>,
  topics: readonly Topic[] | undefined,
  interfaceMode: InterfaceMode = "3d",
): ReadonlySet<string> {
  if (interfaceMode !== "3d" || config.topicsSynchronize !== true) {
    return new Set();
  }
  const result = new Set(
    topics
      ?.filter(
        (topic) =>
          !EXCLUDED_SCHEMAS.has(topic.schemaName) &&
          !isUrdfTopic(topic) &&
          config.topics[topic.name]?.visible === true &&
          config.topics[topic.name]?.synchronize === true,
      )
      .map((topic) => topic.name),
  );
  return result.size >= 2 ? result : new Set();
}

export function extensionSupportsTopicSynchronization(extensionId: string): boolean {
  return extensionId !== "foxglove.Urdfs" && extensionId !== "foxglove.FrameAxes";
}

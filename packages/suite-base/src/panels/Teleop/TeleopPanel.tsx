// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import * as _ from "lodash-es";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DeepPartial } from "ts-essentials";

import { ros1 } from "@lichtblick/rosmsg-msgs-common";
import { SettingsTreeAction, Topic } from "@lichtblick/suite";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import Stack from "@lichtblick/suite-base/components/Stack";
import DirectionalPad from "@lichtblick/suite-base/panels/Teleop/DirectionalPad";
import { buildSettingsTreeTeleop } from "@lichtblick/suite-base/panels/Teleop/buildSettingsTree";
import {
  TeleopConfig,
  DirectionalPadAction,
  TeleopPanelProps,
} from "@lichtblick/suite-base/panels/Teleop/types";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

type TwistMessage = {
  linear: { x: number; y: number; z: number };
  angular: { x: number; y: number; z: number };
};

// Builds a Twist message from a zero basis, injecting the configured field value for the action.
// For STOP the default stopButton config (value 0) yields an all-zero Twist.
function buildTwistMessage(config: TeleopConfig, action: DirectionalPadAction): TwistMessage {
  const message: TwistMessage = {
    linear: {
      x: 0,
      y: 0,
      z: 0,
    },
    angular: {
      x: 0,
      y: 0,
      z: 0,
    },
  };

  function setFieldValue(field: string, value: number) {
    switch (field) {
      case "linear-x":
        message.linear.x = value;
        break;
      case "linear-y":
        message.linear.y = value;
        break;
      case "linear-z":
        message.linear.z = value;
        break;
      case "angular-x":
        message.angular.x = value;
        break;
      case "angular-y":
        message.angular.y = value;
        break;
      case "angular-z":
        message.angular.z = value;
        break;
    }
  }

  switch (action) {
    case DirectionalPadAction.UP:
      setFieldValue(config.upButton.field, config.upButton.value);
      break;
    case DirectionalPadAction.DOWN:
      setFieldValue(config.downButton.field, config.downButton.value);
      break;
    case DirectionalPadAction.LEFT:
      setFieldValue(config.leftButton.field, config.leftButton.value);
      break;
    case DirectionalPadAction.RIGHT:
      setFieldValue(config.rightButton.field, config.rightButton.value);
      break;
    case DirectionalPadAction.STOP:
      setFieldValue(config.stopButton.field, config.stopButton.value);
      break;
    default:
  }

  return message;
}

function TeleopPanel(props: Readonly<TeleopPanelProps>): React.JSX.Element {
  const { context } = props;
  const { saveState } = context;

  const [currentAction, setCurrentAction] = useState<DirectionalPadAction | undefined>();
  const [topics, setTopics] = useState<readonly Topic[]>([]);

  // resolve an initial config which may have some missing fields into a full config
  const [config, setConfig] = useState<TeleopConfig>(() => {
    const partialConfig = context.initialState as DeepPartial<TeleopConfig>;

    const {
      topic,
      publishRate = 1,
      upButton: { field: upField = "linear-x", value: upValue = 1 } = {},
      downButton: { field: downField = "linear-x", value: downValue = -1 } = {},
      leftButton: { field: leftField = "angular-z", value: leftValue = 1 } = {},
      rightButton: { field: rightField = "angular-z", value: rightValue = -1 } = {},
      stopButton: { field: stopField = "linear-x", value: stopValue = 0 } = {},
      autoSendStopOnRelease = false,
    } = partialConfig;

    return {
      topic,
      publishRate,
      upButton: { field: upField, value: upValue },
      downButton: { field: downField, value: downValue },
      leftButton: { field: leftField, value: leftValue },
      rightButton: { field: rightField, value: rightValue },
      stopButton: { field: stopField, value: stopValue },
      autoSendStopOnRelease,
    };
  });

  const settingsActionHandler = useCallback((action: SettingsTreeAction) => {
    if (action.action !== "update") {
      return;
    }

    setConfig((previous) => {
      const newConfig = { ...previous };
      _.set(newConfig, action.payload.path.slice(1), action.payload.value);
      return newConfig;
    });
  }, []);

  // setup context render handler and render done handling
  const [renderDone, setRenderDone] = useState<() => void>(() => () => {});
  const [colorScheme, setColorScheme] = useState<"dark" | "light">("light");
  useLayoutEffect(() => {
    context.watch("topics");
    context.watch("colorScheme");

    context.onRender = (renderState, done) => {
      setTopics(renderState.topics ?? []);
      setRenderDone(() => done);
      if (renderState.colorScheme) {
        setColorScheme(renderState.colorScheme);
      }
    };
  }, [context]);

  useEffect(() => {
    const tree = buildSettingsTreeTeleop(config, topics);
    context.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: tree,
    });
    saveState(config);
  }, [config, context, saveState, settingsActionHandler, topics]);

  // advertise topic
  const { topic: currentTopic } = config;
  const isInitialMount = useRef(true);
  useLayoutEffect(() => {
    if (!currentTopic) {
      return;
    }

    context.advertise?.(currentTopic, "geometry_msgs/Twist", {
      datatypes: new Map([
        ["geometry_msgs/Vector3", ros1["geometry_msgs/Vector3"]],
        ["geometry_msgs/Twist", ros1["geometry_msgs/Twist"]],
      ]),
    });

    return () => {
      if (!isInitialMount.current) {
        context.unadvertise?.(currentTopic);
      }
      isInitialMount.current = false;
    };
  }, [context, currentTopic]);

  useLayoutEffect(() => {
    if (currentAction == undefined || !currentTopic) {
      return;
    }

    const message = buildTwistMessage(config, currentAction);

    // don't publish if rate is 0 or negative - this is a config error on user's part
    if (config.publishRate <= 0) {
      return;
    }

    const publishMessage = () => {
      try {
        context.publish?.(currentTopic, message);
      } catch (error) {
        console.error("Failed to publish message:", error);
      }
    };

    publishMessage();

    // The stop command is published exactly once per press; directional buttons
    // keep publishing at the configured rate while held.
    if (currentAction === DirectionalPadAction.STOP) {
      return;
    }

    const intervalMs = (1000 * 1) / config.publishRate;
    const intervalHandle = setInterval(publishMessage, intervalMs);

    return () => {
      clearInterval(intervalHandle);
    };
  }, [context, config, currentTopic, currentAction]);

  // When stop-on-release is enabled, publish the configured stop message once when a
  // directional button is released. The prev-action ref guards against firing on
  // initial mount and after releasing the stop button itself (it already sent stop).
  const prevActionRef = useRef<DirectionalPadAction | undefined>(undefined);
  useLayoutEffect(() => {
    const prevAction = prevActionRef.current;
    prevActionRef.current = currentAction;

    if (
      currentAction != undefined ||
      prevAction == undefined ||
      prevAction === DirectionalPadAction.STOP ||
      !config.autoSendStopOnRelease ||
      !currentTopic ||
      context.publish == undefined ||
      config.publishRate <= 0
    ) {
      return;
    }

    try {
      context.publish(currentTopic, buildTwistMessage(config, DirectionalPadAction.STOP));
    } catch (error) {
      console.error("Failed to publish message:", error);
    }
  }, [config, context, currentTopic, currentAction]);

  useLayoutEffect(() => {
    renderDone();
  }, [renderDone]);

  const canPublish = context.publish != undefined && config.publishRate > 0;
  const hasTopic = Boolean(currentTopic);
  const enabled = canPublish && hasTopic;

  return (
    <ThemeProvider isDark={colorScheme === "dark"}>
      <Stack
        fullHeight
        justifyContent="center"
        alignItems="center"
        style={{ padding: "min(5%, 8px)", textAlign: "center" }}
      >
        {!canPublish && <EmptyState>Connect to a data source that supports publishing</EmptyState>}
        {canPublish && !hasTopic && (
          <EmptyState>Select a publish topic in the panel settings</EmptyState>
        )}
        {enabled && <DirectionalPad onAction={setCurrentAction} disabled={!enabled} />}
      </Stack>
    </ThemeProvider>
  );
}

export default TeleopPanel;

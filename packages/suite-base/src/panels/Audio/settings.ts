// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";

import { SettingsTreeNodes } from "@lichtblick/suite";
import { Topic } from "@lichtblick/suite-base/players/types";

export function buildSettingsTree(
  topicToRender: string,
  volume: number,
  availableTopics: Topic[],
  t: TFunction<"audio">,
): SettingsTreeNodes {
  const topicOptions = availableTopics.map((topic) => ({
    label: topic.name,
    value: topic.name,
  }));
  const topicIsAvailable = availableTopics.some(
    (topic) => topic.name === topicToRender,
  );
  if (!topicIsAvailable) {
    topicOptions.unshift({ value: topicToRender, label: topicToRender });
  }
  const topicError = topicIsAvailable
    ? undefined
    : t("topicError", { topic: topicToRender });

  return {
    general: {
      fields: {
        topicToRender: {
          input: "select",
          label: t("topic"),
          value: topicToRender,
          error: topicError,
          options: topicOptions,
        },
        volume: {
          input: "slider",
          label: t("volume"),
          value: volume,
          min: 0,
          max: 1,
          step: 0.05,
        },
      },
    },
  };
}

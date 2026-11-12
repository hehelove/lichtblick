// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { AppSetting } from "@lichtblick/suite-base/AppSetting";
import { IAppConfiguration } from "@lichtblick/suite-base/context/AppConfigurationContext";

// 布局同步 workspace 激活：URL 参数优先，其次 AppConfiguration 默认
// （desktop 设置面板 / web 构建烘焙）。空串视为未设置。
export function resolveLayoutSyncWorkspace(
  urlWorkspace: string | null,
  config: Pick<IAppConfiguration, "get">,
): string | undefined {
  if (urlWorkspace != undefined && urlWorkspace.length > 0) {
    return urlWorkspace;
  }
  const value = config.get(AppSetting.LAYOUT_SYNC_WORKSPACE);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

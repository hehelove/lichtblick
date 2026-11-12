// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { AppSetting } from "@lichtblick/suite-base/AppSetting";
import { resolveLayoutSyncWorkspace } from "@lichtblick/suite-base/api/layouts/workspace";
import { AppConfigurationValue } from "@lichtblick/suite-base/context/AppConfigurationContext";

describe("resolveLayoutSyncWorkspace", () => {
  const config = (value: AppConfigurationValue) => ({
    get: (key: string) => (key === AppSetting.LAYOUT_SYNC_WORKSPACE ? value : undefined),
  });

  it("URL 参数优先于配置默认", () => {
    expect(resolveLayoutSyncWorkspace("from-url", config("from-config"))).toBe("from-url");
  });

  it("无 URL 参数时回落到配置值", () => {
    expect(resolveLayoutSyncWorkspace(null, config("from-config"))).toBe("from-config");
  });

  it("配置空串视为未设置", () => {
    expect(resolveLayoutSyncWorkspace(null, config(""))).toBeUndefined();
  });

  it("两者皆空返回 undefined（不激活远端同步）", () => {
    expect(resolveLayoutSyncWorkspace(null, config(undefined))).toBeUndefined();
    expect(resolveLayoutSyncWorkspace("", config(""))).toBeUndefined();
  });
});

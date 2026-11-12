// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** @jest-environment node */


// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import fs from "fs";
import os from "os";
import path from "path";

import { AppSetting } from "@lichtblick/suite-base/src/AppSetting";

import { getAppSetting, setAppSetting } from "./settings";

describe("settings datastore", () => {
  it("setAppSetting preserves keys written by the renderer (same settings.json)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-settings-"));
    try {
      setAppSetting(AppSetting.LANGUAGE, "zh", { overrideUserDataDir: dir });
      setAppSetting(AppSetting.MCP_TOKEN, "abc123", { overrideUserDataDir: dir });

      expect(getAppSetting(AppSetting.LANGUAGE, { overrideUserDataDir: dir })).toBe("zh");
      expect(getAppSetting(AppSetting.MCP_TOKEN, { overrideUserDataDir: dir })).toBe("abc123");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

const STORAGE_KEY_PREFIX = "lichtblick.settings-tree.expansion.v1";

export type ExpansionPreferences = Record<string, boolean>;

export function getExpansionStorageKey(variant: "panel" | "log", panelId?: string): string {
  const editorId = variant === "panel" && panelId != undefined ? `panel:${panelId}` : variant;
  return `${STORAGE_KEY_PREFIX}:${editorId}`;
}

export function encodeExpansionPath(path: readonly string[]): string {
  return JSON.stringify(path) ?? "[]";
}

export function readExpansionPreferences(storageKey: string): ExpansionPreferences {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    if (typeof parsed !== "object" || parsed == undefined || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, boolean] => {
        return typeof entry[1] === "boolean";
      }),
    );
  } catch {
    return {};
  }
}

export function writeExpansionPreferences(
  storageKey: string,
  preferences: ExpansionPreferences,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(preferences) ?? "{}");
  } catch {
    // Storage can be unavailable in private browsing, sandboxed frames, or restricted environments.
  }
}

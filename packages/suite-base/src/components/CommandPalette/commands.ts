// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import useAsyncFn from "react-use/lib/useAsyncFn";

import { PanelSelection } from "@lichtblick/suite-base/components/PanelCatalog";
import { LayoutID } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import { PanelInfo, usePanelCatalog } from "@lichtblick/suite-base/context/PanelCatalogContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import useAddPanel from "@lichtblick/suite-base/hooks/useAddPanel";
import { useLayoutNavigation } from "@lichtblick/suite-base/hooks/useLayoutNavigation";
import { commandPalette } from "@lichtblick/suite-base/i18n/en/commandPalette";
import { Layout } from "@lichtblick/suite-base/services/ILayoutStorage";

import { Command } from "./types";

type Translate = (
  key: keyof typeof commandPalette,
  params?: { name?: string; title?: string },
) => string;

// Interpolates the english templates directly so buildCommands stays a pure function
// that works without an initialized i18n instance (i.e. in tests).
const defaultT: Translate = (key, params) => {
  let label: string = commandPalette[key];
  for (const [name, value] of Object.entries(params ?? {})) {
    label = label.split(`{{${name}}}`).join(value);
  }
  return label;
};

export type BuildCommandsArgs = {
  panels: readonly PanelInfo[];
  layouts: readonly Layout[];
  actions: {
    addPanel: (selection: PanelSelection) => void;
    onSelectLayout: (id: LayoutID) => void;
    openDataSourceDialog: () => void;
    openPreferences: () => void;
    toggleLeftSidebar: () => void;
    toggleRightSidebar: () => void;
    openLayoutBrowser: () => void;
  };
  t?: Translate;
};

export function buildCommands({
  panels,
  layouts,
  actions,
  t = defaultT,
}: BuildCommandsArgs): Command[] {
  const panelCommands: Command[] = panels.map((panel) => ({
    id: `panel:${panel.type}`,
    group: "Panel",
    label: t("addPanel", { title: panel.title }),
    keywords: panel.type,
    run: () => {
      actions.addPanel({ type: panel.type, config: panel.config });
    },
  }));

  const layoutCommands: Command[] = layouts.map((layout) => ({
    id: `layout:${layout.id}`,
    group: "Layout",
    label: t("selectLayout", { name: layout.name }),
    keywords: "layout",
    run: () => {
      actions.onSelectLayout(layout.id);
    },
  }));

  const viewCommands: Command[] = [
    {
      id: "view:openDataSource",
      group: "View",
      label: t("openDataSource"),
      run: actions.openDataSourceDialog,
    },
    {
      id: "view:openPreferences",
      group: "View",
      label: t("openPreferences"),
      run: actions.openPreferences,
    },
    {
      id: "view:toggleLeftSidebar",
      group: "View",
      label: t("toggleLeftSidebar"),
      run: actions.toggleLeftSidebar,
    },
    {
      id: "view:toggleRightSidebar",
      group: "View",
      label: t("toggleRightSidebar"),
      run: actions.toggleRightSidebar,
    },
    {
      id: "view:openLayoutBrowser",
      group: "View",
      label: t("openLayoutBrowser"),
      run: actions.openLayoutBrowser,
    },
  ];

  return [...panelCommands, ...layoutCommands, ...viewCommands];
}

// Mirrors keyboardEventHasModifier in Workspace.tsx (kept local to avoid a circular
// import through Workspace -> WorkspaceDialogs -> CommandPalette -> commands).
const keyboardEventHasModifier = (event: KeyboardEvent) =>
  navigator.userAgent.includes("Mac") ? event.metaKey : event.ctrlKey;

/**
 * KeyListener preventDefaults every matched key unless the handler returns false,
 * so plain "k" must return false to keep typing "k" working outside editable fields.
 */
export function makeCommandPaletteKeyDownHandler(
  open: () => void,
): (event: KeyboardEvent) => boolean | undefined {
  return (event) => {
    if (!keyboardEventHasModifier(event)) {
      return false;
    }
    open();
    return undefined;
  };
}

export function useCommands(): Command[] {
  const { t } = useTranslation("commandPalette");
  const panelCatalog = usePanelCatalog();
  const layoutManager = useLayoutManager();
  const { dialogActions, sidebarActions, openLayoutBrowser } = useWorkspaceActions();
  const addPanel = useAddPanel();
  const { onSelectLayout } = useLayoutNavigation();

  const [layoutsResult] = useAsyncFn(
    async () => await layoutManager.getLayouts(),
    [layoutManager],
    { loading: true },
  );
  const layouts = useMemo(() => layoutsResult.value ?? [], [layoutsResult.value]);

  return useMemo(
    () =>
      buildCommands({
        t,
        panels: panelCatalog.getPanels(),
        layouts,
        actions: {
          addPanel,
          onSelectLayout: (id) => {
            const layout = layouts.find((candidate) => candidate.id === id);
            if (layout) {
              void onSelectLayout(layout);
            }
          },
          openDataSourceDialog: () => {
            dialogActions.dataSource.open("connection");
          },
          openPreferences: () => {
            dialogActions.preferences.open();
          },
          toggleLeftSidebar: () => {
            sidebarActions.left.setOpen((open) => !open);
          },
          toggleRightSidebar: () => {
            sidebarActions.right.setOpen((open) => !open);
          },
          openLayoutBrowser,
        },
      }),
    [
      t,
      panelCatalog,
      layouts,
      addPanel,
      onSelectLayout,
      dialogActions.dataSource,
      dialogActions.preferences,
      sidebarActions.left,
      sidebarActions.right,
      openLayoutBrowser,
    ],
  );
}

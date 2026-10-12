// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Fragment, Suspense, useEffect, useMemo } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

import { AppSetting } from "@lichtblick/suite-base/AppSetting";
import { IdbLayoutStorage } from "@lichtblick/suite-base/IdbLayoutStorage";
import { LayoutsAPI } from "@lichtblick/suite-base/api/layouts/LayoutsAPI";
import { resolveLayoutSyncWorkspace } from "@lichtblick/suite-base/api/layouts/workspace";
import { APP_CONFIG } from "@lichtblick/suite-base/constants/config";
import { useAppConfiguration } from "@lichtblick/suite-base/context/AppConfigurationContext";
import LayoutStorageContext from "@lichtblick/suite-base/context/LayoutStorageContext";
import NativeAppMenuContext from "@lichtblick/suite-base/context/NativeAppMenuContext";
import NativeWindowContext from "@lichtblick/suite-base/context/NativeWindowContext";
import { RemoteLayoutStorageContext } from "@lichtblick/suite-base/context/RemoteLayoutStorageContext";
import { useSharedRootContext } from "@lichtblick/suite-base/context/SharedRootContext";
import AlertsContextProvider from "@lichtblick/suite-base/providers/AlertsContextProvider";
import EventsProvider from "@lichtblick/suite-base/providers/EventsProvider";
import LayoutManagerProvider from "@lichtblick/suite-base/providers/LayoutManagerProvider";
import { StudioLogsSettingsProvider } from "@lichtblick/suite-base/providers/StudioLogsSettingsProvider";
import TimelineInteractionStateProvider from "@lichtblick/suite-base/providers/TimelineInteractionStateProvider";
import UserProfileLocalStorageProvider from "@lichtblick/suite-base/providers/UserProfileLocalStorageProvider";
import HttpService from "@lichtblick/suite-base/services/http/HttpService";

import Workspace from "./Workspace";
import DocumentTitleAdapter from "./components/DocumentTitleAdapter";
import MultiProvider from "./components/MultiProvider";
import PlayerManager from "./components/PlayerManager";
import SendNotificationToastAdapter from "./components/SendNotificationToastAdapter";
import StudioToastProvider from "./components/StudioToastProvider";
import { UserScriptStateProvider } from "./context/UserScriptStateContext";
import CurrentLayoutProvider from "./providers/CurrentLayoutProvider";
import ExtensionCatalogProvider from "./providers/ExtensionCatalogProvider/ExtensionCatalogProvider";
import ExtensionMarketplaceProvider from "./providers/ExtensionMarketplaceProvider";
import PanelCatalogProvider from "./providers/PanelCatalogProvider";
import { LaunchPreference } from "./screens/LaunchPreference";

// Suppress context menu for the entire app except on inputs & textareas.
function contextMenuHandler(event: MouseEvent) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }

  event.preventDefault();
  return false;
}

export function StudioApp(): React.JSX.Element {
  const {
    dataSources,
    extensionLoaders,
    nativeAppMenu,
    nativeWindow,
    deepLinks,
    enableLaunchPreferenceScreen,
    extraProviders,
    appBarLeftInset,
    customWindowControlProps,
    onAppBarDoubleClick,
    AppBarComponent,
  } = useSharedRootContext();

  const providers = [
    /* eslint-disable react/jsx-key */
    <TimelineInteractionStateProvider />,
    <ExtensionMarketplaceProvider />,
    <ExtensionCatalogProvider loaders={extensionLoaders} />,
    <UserScriptStateProvider />,
    <PlayerManager playerSources={dataSources} />,
    <EventsProvider />,
    /* eslint-enable react/jsx-key */
  ];

  if (nativeAppMenu) {
    providers.push(<NativeAppMenuContext.Provider value={nativeAppMenu} />);
  }

  if (nativeWindow) {
    providers.push(<NativeWindowContext.Provider value={nativeWindow} />);
  }

  // The toast and logs provider comes first so they are available to all downstream providers
  providers.unshift(<StudioToastProvider />);
  providers.unshift(<StudioLogsSettingsProvider />);

  // Alerts provider also must come before other, dependent contexts.
  providers.unshift(<AlertsContextProvider />);
  providers.unshift(<CurrentLayoutProvider />);
  providers.unshift(<UserProfileLocalStorageProvider />);
  providers.unshift(<LayoutManagerProvider />);

  const appConfiguration = useAppConfiguration();
  const layoutStorage = useMemo(() => new IdbLayoutStorage(), []);

  providers.unshift(<LayoutStorageContext.Provider value={layoutStorage} />);
  const MaybeLaunchPreference = enableLaunchPreferenceScreen === true ? LaunchPreference : Fragment;

  const url = new URL(window.location.href);
  const workspace = resolveLayoutSyncWorkspace(url.searchParams.get("workspace"), appConfiguration);

  // PAT Bearer 注入（desktop）：设置面板改动即时生效（监听配置变化），无需重启。
  useEffect(() => {
    const applyToken = (value: string | number | boolean | undefined): void => {
      HttpService.setAuthToken(typeof value === "string" && value.length > 0 ? value : undefined);
    };
    applyToken(appConfiguration.get(AppSetting.LAYOUT_SYNC_API_TOKEN));
    appConfiguration.addChangeListener(AppSetting.LAYOUT_SYNC_API_TOKEN, applyToken);
    return () => {
      appConfiguration.removeChangeListener(AppSetting.LAYOUT_SYNC_API_TOKEN, applyToken);
    };
  }, [appConfiguration]);

  // 渲染期同步注入：子组件 effect 先于本组件 effect 执行，首同步必须已带上 PAT。
  const layoutSyncToken = appConfiguration.get(AppSetting.LAYOUT_SYNC_API_TOKEN);
  HttpService.setAuthToken(
    typeof layoutSyncToken === "string" && layoutSyncToken.length > 0 ? layoutSyncToken : undefined,
  );

  const remoteLayoutStorage = useMemo(() => {
    if (workspace && APP_CONFIG.apiUrl) {
      return new LayoutsAPI(workspace);
    }
    return undefined;
  }, [workspace]);

  if (remoteLayoutStorage) {
    providers.unshift(<RemoteLayoutStorageContext.Provider value={remoteLayoutStorage} />);
  }

  if (extraProviders) {
    // Providers supplying context consumed by providers above them in this list must stay outermost,
    // otherwise those consumers silently fall back to the context default (for example analytics).
    providers.unshift(...extraProviders);
  }

  useEffect(() => {
    document.addEventListener("contextmenu", contextMenuHandler);
    return () => {
      document.removeEventListener("contextmenu", contextMenuHandler);
    };
  }, []);

  return (
    <MaybeLaunchPreference>
      <MultiProvider providers={providers}>
        <DocumentTitleAdapter />
        <SendNotificationToastAdapter />
        <DndProvider backend={HTML5Backend}>
          <Suspense fallback={<></>}>
            <PanelCatalogProvider>
              <Workspace
                deepLinks={deepLinks}
                appBarLeftInset={appBarLeftInset}
                onAppBarDoubleClick={onAppBarDoubleClick}
                showCustomWindowControls={customWindowControlProps?.showCustomWindowControls}
                isMaximized={customWindowControlProps?.isMaximized}
                initialZoomFactor={customWindowControlProps?.initialZoomFactor}
                onMinimizeWindow={customWindowControlProps?.onMinimizeWindow}
                onMaximizeWindow={customWindowControlProps?.onMaximizeWindow}
                onUnmaximizeWindow={customWindowControlProps?.onUnmaximizeWindow}
                onCloseWindow={customWindowControlProps?.onCloseWindow}
                AppBarComponent={AppBarComponent}
              />
            </PanelCatalogProvider>
          </Suspense>
        </DndProvider>
      </MultiProvider>
    </MaybeLaunchPreference>
  );
}

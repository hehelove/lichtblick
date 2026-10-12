// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Brightness5Icon from "@mui/icons-material/Brightness5";
import ComputerIcon from "@mui/icons-material/Computer";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import QuestionAnswerOutlinedIcon from "@mui/icons-material/QuestionAnswerOutlined";
import WebIcon from "@mui/icons-material/Web";
import {
  Autocomplete,
  Button,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  ToggleButtonGroupProps,
  Typography,
} from "@mui/material";
import moment from "moment-timezone";
import { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { filterMap } from "@lichtblick/den/collection";
import { AppSetting } from "@lichtblick/suite-base/AppSetting";
import OsContextSingleton from "@lichtblick/suite-base/OsContextSingleton";
import CopyButton from "@lichtblick/suite-base/components/CopyButton";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useAppTimeFormat } from "@lichtblick/suite-base/hooks";
import { useAppConfigurationValue } from "@lichtblick/suite-base/hooks/useAppConfigurationValue";
import { Language } from "@lichtblick/suite-base/i18n";
import { reportError } from "@lichtblick/suite-base/reportError";
import { LaunchPreferenceValue } from "@lichtblick/suite-base/types/LaunchPreferenceValue";
import { TimeDisplayMethod } from "@lichtblick/suite-base/types/panels";
import { formatTime } from "@lichtblick/suite-base/util/formatTime";
import { formatTimeRaw } from "@lichtblick/suite-base/util/time";

const MESSAGE_RATES = [1, 3, 5, 10, 15, 20, 30, 60];
const LANGUAGE_OPTIONS: { key: Language; value: string }[] = [{ key: "en", value: "English" }];

const useStyles = makeStyles()((theme) => ({
  checkbox: {
    "&.MuiCheckbox-root": {
      paddingTop: 0,
    },
  },
  formControlLabel: {
    "&.MuiFormControlLabel-root": {
      alignItems: "start",
    },
  },
  toggleButton: {
    display: "flex !important",
    flexDirection: "column",
    gap: theme.spacing(0.75),
    lineHeight: "1 !important",
  },
}));

function formatTimezone(name: string) {
  const tz = moment.tz(name);
  const zoneAbbr = tz.zoneAbbr();
  const offset = tz.utcOffset();
  const offsetStr =
    (offset >= 0 ? "+" : "") + moment.duration(offset, "minutes").format("hh:mm", { trim: false });
  if (name === zoneAbbr) {
    return `${zoneAbbr} (${offsetStr})`;
  }
  return `${name} (${zoneAbbr}, ${offsetStr})`;
}

export function ColorSchemeSettings(): React.JSX.Element {
  const { classes } = useStyles();
  const [colorScheme = "system", setColorScheme] = useAppConfigurationValue<string>(
    AppSetting.COLOR_SCHEME,
  );
  const { t } = useTranslation("appSettings");

  const handleChange = useCallback(
    (_event: MouseEvent<HTMLElement>, value?: string) => {
      if (value != undefined) {
        void setColorScheme(value);
      }
    },
    [setColorScheme],
  );

  return (
    <Stack>
      <FormLabel>{t("colorScheme")}:</FormLabel>
      <ToggleButtonGroup
        color="primary"
        size="small"
        fullWidth
        exclusive
        value={colorScheme}
        onChange={handleChange}
      >
        <ToggleButton className={classes.toggleButton} value="dark">
          <DarkModeIcon /> {t("dark")}
        </ToggleButton>
        <ToggleButton className={classes.toggleButton} value="light">
          <Brightness5Icon /> {t("light")}
        </ToggleButton>
        <ToggleButton className={classes.toggleButton} value="system">
          <ComputerIcon /> {t("followSystem")}
        </ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  );
}

export function TimezoneSettings(): React.ReactElement {
  type Option = { key: string; label: string; data?: string; divider?: boolean };

  const { t } = useTranslation("appSettings");
  const [timezone, setTimezone] = useAppConfigurationValue<string>(AppSetting.TIMEZONE);
  const detectItem: Option = useMemo(
    () => ({
      key: "detect",
      label: `Detect from system: ${formatTimezone(moment.tz.guess())}`,
      data: undefined,
    }),
    [],
  );
  const fixedItems: Option[] = useMemo(
    () => [
      detectItem,
      { key: "zone:UTC", label: formatTimezone("UTC"), data: "UTC" },
      {
        key: "sep",
        label: "",
        divider: true,
      },
    ],
    [detectItem],
  );

  const timezoneItems: Option[] = useMemo(
    () =>
      filterMap(moment.tz.names(), (name) => {
        // UTC is always hoisted to the top in fixedItems
        if (name === "UTC") {
          return undefined;
        }
        return { key: `zone:${name}`, label: formatTimezone(name), data: name };
      }),
    [],
  );

  const allItems = useMemo(() => [...fixedItems, ...timezoneItems], [fixedItems, timezoneItems]);

  const selectedItem = useMemo(() => {
    if (timezone != undefined) {
      return allItems.find((item) => item.data === timezone) ?? detectItem;
    }
    return detectItem;
  }, [allItems, detectItem, timezone]);

  return (
    <FormControl fullWidth>
      <FormLabel>{t("displayTimestampsIn")}:</FormLabel>
      <Autocomplete
        options={[...fixedItems, ...timezoneItems]}
        value={selectedItem}
        renderOption={(props, option: Option) =>
          option.divider === true ? (
            <Divider key={option.key} />
          ) : (
            <li {...props} key={option.key}>
              {option.label}
            </li>
          )
        }
        renderInput={(params) => <TextField {...params} />}
        onChange={(_event, value) => void setTimezone(value?.data)}
      />
    </FormControl>
  );
}

export function TimeFormat({
  orientation = "vertical",
}: {
  orientation?: ToggleButtonGroupProps["orientation"];
}): React.ReactElement {
  const { timeFormat, setTimeFormat } = useAppTimeFormat();

  const { t } = useTranslation("appSettings");

  const [timezone] = useAppConfigurationValue<string>(AppSetting.TIMEZONE);

  const exampleTime = { sec: 946713600, nsec: 0 };

  return (
    <Stack>
      <FormLabel>{t("timestampFormat")}:</FormLabel>
      <ToggleButtonGroup
        color="primary"
        size="small"
        orientation={orientation}
        fullWidth
        exclusive
        value={timeFormat}
        onChange={(_, value?: TimeDisplayMethod) => value != undefined && void setTimeFormat(value)}
      >
        <ToggleButton value="SEC" data-testid="timeformat-seconds">
          {formatTimeRaw(exampleTime)}
        </ToggleButton>
        <ToggleButton value="TOD" data-testid="timeformat-local">
          {formatTime(exampleTime, timezone)}
        </ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  );
}

export function LaunchDefault(): React.ReactElement {
  const { classes } = useStyles();
  const { t } = useTranslation("appSettings");
  const [preference, setPreference] = useAppConfigurationValue<string | undefined>(
    AppSetting.LAUNCH_PREFERENCE,
  );
  let sanitizedPreference: LaunchPreferenceValue;
  switch (preference) {
    case LaunchPreferenceValue.WEB:
    case LaunchPreferenceValue.DESKTOP:
    case LaunchPreferenceValue.ASK:
      sanitizedPreference = preference;
      break;
    default:
      sanitizedPreference = LaunchPreferenceValue.WEB;
  }

  return (
    <Stack>
      <FormLabel>{t("openLinksIn")}:</FormLabel>
      <ToggleButtonGroup
        color="primary"
        size="small"
        fullWidth
        exclusive
        value={sanitizedPreference}
        onChange={(_, value?: string) => value != undefined && void setPreference(value)}
      >
        <ToggleButton value={LaunchPreferenceValue.WEB} className={classes.toggleButton}>
          <WebIcon /> {t("webApp")}
        </ToggleButton>
        <ToggleButton value={LaunchPreferenceValue.DESKTOP} className={classes.toggleButton}>
          <ComputerIcon /> {t("desktopApp")}
        </ToggleButton>
        <ToggleButton value={LaunchPreferenceValue.ASK} className={classes.toggleButton}>
          <QuestionAnswerOutlinedIcon /> {t("askEachTime")}
        </ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  );
}

export function MessageFramerate(): React.ReactElement {
  const { t } = useTranslation("appSettings");
  const [messageRate, setMessageRate] = useAppConfigurationValue<number>(AppSetting.MESSAGE_RATE);
  const options = useMemo(
    () => MESSAGE_RATES.map((rate) => ({ key: rate, text: `${rate}`, data: rate })),
    [],
  );

  return (
    <Stack>
      <FormLabel>{t("messageRate")} (Hz):</FormLabel>
      <Select
        value={messageRate ?? 60}
        fullWidth
        onChange={(event) => void setMessageRate(event.target.value)}
      >
        {options.map((option) => (
          <MenuItem key={option.key} value={option.key}>
            {option.text}
          </MenuItem>
        ))}
      </Select>
    </Stack>
  );
}

export function StepSize(): React.ReactElement {
  const { t } = useTranslation("appSettings");
  const defaultStepSize = 100;
  const minStepSize = 1;

  const [stepSize = defaultStepSize, setStepSize] = useAppConfigurationValue<number>(
    AppSetting.DEFAULT_STEP_SIZE,
  );

  const valueValidation = (value: number) => isNaN(value) || value < minStepSize;
  const isStepSizeInvalid = valueValidation(stepSize);

  const latestStepSizeRef = useRef(stepSize);
  latestStepSizeRef.current = stepSize;

  useEffect(() => {
    return () => {
      const latest = latestStepSizeRef.current;
      if (valueValidation(latest)) {
        void setStepSize(defaultStepSize);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Stack>
      <FormLabel>{t("stepSize")} (ms):</FormLabel>
      <TextField
        id="stepSizeInput"
        fullWidth
        type="number"
        value={stepSize}
        onChange={(event) => {
          void setStepSize(parseInt(event.target.value));
        }}
        slotProps={{
          input: {
            type: "number",
            sx: {
              "& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button": {
                display: "none",
              },
              "& input[type=number]": {
                MozAppearance: "textfield",
              },
            },
          },
        }}
        error={isStepSizeInvalid}
        helperText={isStepSizeInvalid ? "Step size will default to 100ms" : " "}
      ></TextField>
    </Stack>
  );
}

export function AutoUpdate(): React.ReactElement {
  const [updatesEnabled = false, setUpdatedEnabled] = useAppConfigurationValue<boolean>(
    AppSetting.UPDATES_ENABLED,
  );

  const { classes } = useStyles();

  return (
    <>
      <FormLabel>Updates:</FormLabel>
      <FormControlLabel
        className={classes.formControlLabel}
        control={
          <Checkbox
            className={classes.checkbox}
            checked={updatesEnabled}
            onChange={(_event, checked) => void setUpdatedEnabled(checked)}
          />
        }
        label="Automatically install updates"
      />
    </>
  );
}

export function RosPackagePath(): React.ReactElement {
  const [rosPackagePath, setRosPackagePath] = useAppConfigurationValue<string>(
    AppSetting.ROS_PACKAGE_PATH,
  );

  const rosPackagePathPlaceholder = useMemo(
    () => OsContextSingleton?.getEnvVar("ROS_PACKAGE_PATH"),
    [],
  );

  return (
    <TextField
      fullWidth
      label="ROS_PACKAGE_PATH"
      placeholder={rosPackagePathPlaceholder}
      value={rosPackagePath ?? ""}
      onChange={(event) => void setRosPackagePath(event.target.value)}
    />
  );
}

// suite-base must not import from suite-desktop, so the fallback port is duplicated here.
// Keep in sync with DEFAULT_MCP_PORT in packages/suite-desktop/src/main/mcp/McpServer.ts.
const DEFAULT_MCP_PORT = 7333;

/** Structural slice of the desktop preload bridge, mirroring `Desktop.updateMcpServer`. */
type McpServerState = {
  enabled: boolean;
  port: number;
  token: string;
  /** Whether the HTTP socket is actually bound — `enabled` is only the setting. */
  listening: boolean;
};

type McpBridge = {
  updateMcpServer(options?: { regenerateToken?: boolean }): Promise<McpServerState>;
};

export function McpServerSettings(): React.ReactElement | null {
  const { t } = useTranslation("appSettings");
  const desktopBridge = (global as { desktopBridge?: McpBridge }).desktopBridge;
  const [enabled = false, setEnabled] = useAppConfigurationValue<boolean>(AppSetting.MCP_ENABLED);
  const [tokenFromSettings] = useAppConfigurationValue<string>(AppSetting.MCP_TOKEN);
  const [portFromSettings] = useAppConfigurationValue<number>(AppSetting.MCP_PORT);

  // Main-process writes (first-enable token generation, regeneration) never propagate back to
  // this process, so values returned from updateMcpServer are overlaid on the settings-derived
  // display state. The checkbox itself always follows the setting — this renderer is the sole
  // writer of MCP_ENABLED, so the hook value is at least as fresh as any overlay and cannot be
  // masked by a stale async reply.
  const [refreshed, setRefreshed] = useState<McpServerState>();

  if (desktopBridge == undefined) {
    return null;
  }

  const isEnabled = enabled;
  const port = refreshed?.port ?? portFromSettings ?? DEFAULT_MCP_PORT;
  const token = refreshed?.token ?? tokenFromSettings ?? "";
  const mcpUrl = `http://127.0.0.1:${port}/mcp`;
  const claudeCodeSnippet = `claude mcp add --transport http lichtblick ${mcpUrl} --header "Authorization: Bearer ${token}"`;
  const claudeDesktopSnippet = `npx mcp-remote ${mcpUrl} --header "Authorization: Bearer ${token}"`;
  // ponytail: listening truth is last-interaction truth (no push channel); a boot-time port
  // conflict shows as listening until the first toggle/regenerate reports it.
  const statusText = !isEnabled
    ? t("mcpStatusOff")
    : refreshed?.listening === false
      ? t("mcpStatusFailed", { port })
      : t("mcpStatusListening", { port });

  const handleRegenerate = async () => {
    try {
      setRefreshed(await desktopBridge.updateMcpServer({ regenerateToken: true }));
    } catch (error) {
      reportError(error as Error);
    }
  };

  // The toggle is the single restart trigger and consumes the returned state — without this the
  // token main generates on FIRST enable (settings write, no cross-process propagation) would
  // never reach the display until Regenerate or app restart.
  const handleEnableChange = async ({ enabled: next }: { enabled: boolean }) => {
    try {
      await setEnabled(next);
      setRefreshed(await desktopBridge.updateMcpServer());
    } catch (error) {
      reportError(error as Error);
    }
  };

  return (
    <Stack testId="mcp-settings" gap={1}>
      <FormLabel>{t("agentsMcp")}:</FormLabel>
      <FormControlLabel
        control={
          <Checkbox
            checked={isEnabled}
            onChange={(_event, checked) => {
              void handleEnableChange({ enabled: checked });
            }}
          />
        }
        label={t("mcpEnable")}
      />
      <Typography variant="body2">{statusText}</Typography>
      <Stack direction="row" alignItems="center" gap={1}>
        <TextField
          fullWidth
          size="small"
          label={t("mcpTokenLabel")}
          value={token}
          slotProps={{ input: { readOnly: true } }}
        />
        <CopyButton size="small" getText={() => token} aria-label={t("mcpCopyToken")} />
        <Button size="small" variant="outlined" onClick={() => void handleRegenerate()}>
          {t("mcpRegenerateToken")}
        </Button>
      </Stack>
      <Typography variant="body2">{t("mcpConnectAgent")}:</Typography>
      <Stack direction="row" alignItems="center" gap={1}>
        <TextField
          fullWidth
          size="small"
          label={t("mcpClaudeCode")}
          value={claudeCodeSnippet}
          slotProps={{ input: { readOnly: true } }}
        />
        <CopyButton size="small" getText={() => claudeCodeSnippet} aria-label={t("mcpCopySnippet")} />
      </Stack>
      <Stack direction="row" alignItems="center" gap={1}>
        <TextField
          fullWidth
          size="small"
          label={t("mcpClaudeDesktop")}
          value={claudeDesktopSnippet}
          slotProps={{ input: { readOnly: true } }}
        />
        <CopyButton
          size="small"
          getText={() => claudeDesktopSnippet}
          aria-label={t("mcpCopySnippet")}
        />
      </Stack>
    </Stack>
  );
}

export function LanguageSettings(): React.ReactElement {
  const { t, i18n } = useTranslation("appSettings");
  const [selectedLanguage = "en", setSelectedLanguage] = useAppConfigurationValue<Language>(
    AppSetting.LANGUAGE,
  );
  const onChangeLanguage = useCallback(
    (event: SelectChangeEvent<Language>) => {
      const lang = event.target.value;
      void setSelectedLanguage(lang);
      i18n.changeLanguage(lang).catch((error: unknown) => {
        console.error("Failed to switch languages", error);
        reportError(error as Error);
      });
    },
    [i18n, setSelectedLanguage],
  );
  const options: { key: string; text: string; data: string }[] = useMemo(
    () =>
      LANGUAGE_OPTIONS.map((language) => ({
        key: language.key,
        text: language.value,
        data: language.key,
      })),
    [],
  );

  return (
    <Stack>
      <FormLabel>{t("language")}:</FormLabel>
      <Select<Language> value={selectedLanguage} fullWidth onChange={onChangeLanguage}>
        {options.map((option) => (
          <MenuItem key={option.key} value={option.key}>
            {option.text}
          </MenuItem>
        ))}
      </Select>
    </Stack>
  );
}

export function LayoutSyncSettings(): React.ReactElement {
  const [workspace = "", setWorkspace] = useAppConfigurationValue<string>(
    AppSetting.LAYOUT_SYNC_WORKSPACE,
  );
  const [token = "", setToken] = useAppConfigurationValue<string>(AppSetting.LAYOUT_SYNC_API_TOKEN);

  return (
    <Stack gap={1}>
      <TextField
        fullWidth
        label="Layout sync workspace"
        placeholder="default"
        value={workspace}
        onChange={(event) => void setWorkspace(event.target.value)}
      />
      <TextField
        fullWidth
        label="Layout sync API token (PAT)"
        placeholder="xs_pat_…"
        value={token}
        onChange={(event) => void setToken(event.target.value)}
      />
      <Typography variant="inherit" color="text.secondary">
        Workspace applies after restart; the token applies immediately.
      </Typography>
    </Stack>
  );
}

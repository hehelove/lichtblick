// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import {
  Dialog,
  DialogContent,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListSubheader,
  TextField,
} from "@mui/material";
import {
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import TextHighlight from "@lichtblick/suite-base/components/TextHighlight";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import fuzzyFilter from "@lichtblick/suite-base/util/fuzzyFilter";

import { useCommands } from "./commands";
import { Command } from "./types";

const useStyles = makeStyles()({
  list: {
    maxHeight: 320,
    overflowY: "auto",
    paddingTop: 0,
  },
});

type Props = {
  commands: Command[];
  onClose: () => void;
};

/**
 * Pure command palette: fuzzy-filtered list with keyboard navigation.
 * Wired to the workspace via {@link WorkspaceCommandPalette}.
 */
export function CommandPalette({ commands, onClose }: Props): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("commandPalette");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(
    () =>
      fuzzyFilter({
        options: commands,
        filter: query,
        getText: (command) => `${command.label} ${command.keywords ?? ""}`,
      }),
    [commands, query],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const runCommand = useCallback(
    (command: Command) => {
      if (command.disabled === true) {
        return;
      }
      command.run();
      onClose();
    },
    [onClose],
  );

  const handleTextFieldKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const index = Math.min(activeIndex, filtered.length - 1);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex(Math.min(index + 1, filtered.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(Math.max(index - 1, 0));
      } else if (event.key === "Enter") {
        const command = filtered[index];
        if (command) {
          event.preventDefault();
          runCommand(command);
        }
      }
      // Escape bubbles up to the Dialog, which closes via onClose.
    },
    [activeIndex, filtered, runCommand],
  );

  const activeId = filtered[Math.min(activeIndex, filtered.length - 1)]?.id;

  const rows: React.JSX.Element[] = [];
  (["Panel", "Layout", "View"] as const).forEach((group) => {
    const groupCommands = filtered.filter((command) => command.group === group);
    if (groupCommands.length === 0) {
      return;
    }
    rows.push(<ListSubheader key={group}>{t(`group${group}`)}</ListSubheader>);
    for (const command of groupCommands) {
      rows.push(
        <ListItem key={command.id} disablePadding>
          <ListItemButton
            selected={command.id === activeId}
            disabled={command.disabled}
            onClick={() => {
              runCommand(command);
            }}
          >
            <ListItemText
              primary={<TextHighlight targetStr={command.label} searchText={query} />}
            />
          </ListItemButton>
        </ListItem>,
      );
    }
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-label={t("title")}>
      <TextField
        autoFocus
        variant="filled"
        fullWidth
        placeholder={t("searchPlaceholder")}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        onKeyDown={handleTextFieldKeyDown}
      />
      <DialogContent className={classes.list} dividers>
        {filtered.length === 0 ? <EmptyState>{t("noResults")}</EmptyState> : <List>{rows}</List>}
      </DialogContent>
    </Dialog>
  );
}

/** Connects the pure palette to the workspace commands and dialog state. */
export function WorkspaceCommandPalette(): React.JSX.Element {
  const commands = useCommands();
  const { dialogActions } = useWorkspaceActions();
  return <CommandPalette commands={commands} onClose={dialogActions.commandPalette.close} />;
}

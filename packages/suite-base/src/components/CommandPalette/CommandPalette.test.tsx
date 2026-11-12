/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import "@testing-library/jest-dom";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import KeyListener from "@lichtblick/suite-base/components/KeyListener";
import { commandPalette } from "@lichtblick/suite-base/i18n/en/commandPalette";

import { CommandPalette } from "./CommandPalette";
import { makeCommandPaletteKeyDownHandler } from "./commands";
import { Command } from "./types";

function makeCommands(run: () => void = jest.fn()): Command[] {
  return [
    { id: "a", group: "View", label: "Open preferences", run },
    { id: "b", group: "View", label: "Toggle left sidebar", run: jest.fn() },
  ];
}

describe("CommandPalette", () => {
  it("filters via fuzzyFilter and runs the selection on Enter", async () => {
    const run = jest.fn();
    const onClose = jest.fn();
    const commands: Command[] = [
      { id: "a", group: "View", label: "Open preferences", run },
      { id: "b", group: "View", label: "Toggle left sidebar", run: jest.fn() },
    ];
    render(<CommandPalette commands={commands} onClose={onClose} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "pref" } });
    await waitFor(() => {
      expect(screen.queryByText("Toggle left sidebar")).toBeNull();
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape only closes", () => {
    const run = jest.fn();
    const onClose = jest.fn();
    render(<CommandPalette commands={makeCommands(run)} onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("moves the selection with ArrowDown and Enter runs it", () => {
    const first = jest.fn();
    const second = jest.fn();
    const commands: Command[] = [
      { id: "a", group: "View", label: "Open preferences", run: first },
      { id: "b", group: "View", label: "Toggle left sidebar", run: second },
    ];
    render(<CommandPalette commands={commands} onClose={jest.fn()} />);

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });

  it("shows the empty state when nothing matches", async () => {
    render(<CommandPalette commands={makeCommands()} onClose={jest.fn()} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "zzzzzz" } });

    await waitFor(() => {
      expect(screen.getByText(commandPalette.noResults)).toBeInTheDocument();
    });
    expect(screen.queryByText("Open preferences")).toBeNull();
  });
});

describe("command palette keyboard shortcut", () => {
  it("dispatching ctrl/cmd+k opens the palette and swallows the event", () => {
    const open = jest.fn();
    render(<KeyListener global keyDownHandlers={{ k: makeCommandPaletteKeyDownHandler(open) }} />);

    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true });
    document.dispatchEvent(event);

    expect(open).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("plain k without a modifier does not open and is not prevented", () => {
    const open = jest.fn();
    render(<KeyListener global keyDownHandlers={{ k: makeCommandPaletteKeyDownHandler(open) }} />);

    const event = new KeyboardEvent("keydown", { key: "k", cancelable: true });
    document.dispatchEvent(event);

    expect(open).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

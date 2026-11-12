/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// AppBarIconButton reads theme.palette.appBar (tss-react), so the rows render under the real
// ThemeProvider; i18n is initialized globally by the jest setup, so t() returns real English.
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useCompareStore } from "@lichtblick/suite-base/dataSources/compareStore";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";
import showOpenFilePicker from "@lichtblick/suite-base/util/showOpenFilePicker";

import { CompareSourcesButton } from "./CompareSourcesButton";

jest.mock("@lichtblick/suite-base/context/PlayerSelectionContext", () => ({
  usePlayerSelection: jest.fn(),
}));

// The comparison-session gate agrees with the store flag only when the player name matches.
// Tests retarget mockPlayerName and rerender to simulate player swaps — including the undefined
// "blink" a same-session rebuild emits between tearing one player down and starting the next.
let mockPlayerName: string | undefined = "Comparison: a.mcap, b.bag";

jest.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  useMessagePipeline: (sel: (ctx: unknown) => unknown) =>
    sel({ playerState: { name: mockPlayerName } }),
}));

jest.mock("@lichtblick/suite-base/util/showOpenFilePicker", () => jest.fn());

jest.mock("notistack", () => ({
  enqueueSnackbar: jest.fn(),
}));

const mockSelectSource = jest.fn();

function makeFile(name: string): File {
  return new File(["x"], name);
}

function renderButton() {
  return render(
    <ThemeProvider isDark>
      <CompareSourcesButton />
    </ThemeProvider>,
  );
}

function openPopover(): void {
  // AppBarIconButton routes `title` into the Tooltip (not the DOM), and MUI's Tooltip wrapper
  // clones aria-label onto a wrapper div too — so the button is targeted by its data-testid,
  // the same way the other AppBar icon buttons are.
  fireEvent.click(screen.getByTestId("CompareSourcesButton"));
}

function rerenderButton(root: ReturnType<typeof render>): void {
  root.rerender(
    <ThemeProvider isDark>
      <CompareSourcesButton />
    </ThemeProvider>,
  );
}

describe("CompareSourcesButton", () => {
  beforeEach(() => {
    mockSelectSource.mockReset();
    mockPlayerName = "Comparison: a.mcap, b.bag";
    (usePlayerSelection as jest.Mock).mockReturnValue({ selectSource: mockSelectSource });
    useCompareStore.getState().endSession();
    useCompareStore.getState().sessionFor([makeFile("a.mcap"), makeFile("b.bag")]);
  });

  it("renders nothing outside a comparison session", () => {
    useCompareStore.getState().endSession();
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it("lists slots with offset inputs in seconds", async () => {
    renderButton();
    openPopover();
    expect(await screen.findByText("a.mcap")).toBeTruthy();
    expect(screen.getByText("b.bag")).toBeTruthy();
    expect(screen.getByLabelText("Offset A (s)")).toHaveValue("0");
    const trigger = screen.getByTestId("CompareSourcesButton");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", "comparison-sources-popover");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("commits a valid offset by rebuilding the player with the same files", async () => {
    const { getState } = useCompareStore;
    renderButton();
    openPopover();
    const input = screen.getByLabelText("Offset A (s)");
    fireEvent.change(input, { target: { value: "2.5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(getState().slots.find((s) => s.slot === "A")?.offsetNs).toEqual(2_500_000_000n);
      expect(mockSelectSource).toHaveBeenCalledWith("compare-files", {
        type: "file",
        files: getState().slots.map((s) => s.file),
      });
    });
  });

  it("rejects invalid offset input without rebuilding", async () => {
    renderButton();
    openPopover();
    const input = screen.getByLabelText("Offset A (s)");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(input).toHaveAttribute("aria-invalid", "true");
    });
    expect(mockSelectSource).not.toHaveBeenCalled();
    expect(useCompareStore.getState().slots[0]?.offsetNs).toEqual(0n);
  });

  it("removes a slot (disabled for the last one) and rebuilds", async () => {
    const { getState } = useCompareStore;
    renderButton();
    openPopover();
    fireEvent.click(await screen.findByTitle("Remove slot B"));
    await waitFor(() => {
      expect(mockSelectSource).toHaveBeenCalledWith("compare-files", {
        type: "file",
        files: [getState().slots[0]!.file],
      });
    });
    expect(screen.getByTitle("Remove slot A")).toBeDisabled();
  });

  it("Add file appends a slot and rebuilds with the full list (not a new session)", async () => {
    const { getState } = useCompareStore;
    const c = makeFile("c.db3");
    (showOpenFilePicker as jest.Mock).mockResolvedValue([{ getFile: async () => c }]);
    renderButton();
    openPopover();
    fireEvent.click(await screen.findByText("Add file…"));
    await waitFor(() => {
      expect(mockSelectSource).toHaveBeenCalledWith("compare-files", {
        type: "file",
        files: getState().slots.map((s) => s.file), // a.mcap + b.bag + c.db3
      });
    });
    expect(getState().slots.map((s) => s.slot)).toEqual(["A", "B", "C"]);
    expect(getState().slots.map((s) => s.fileName)).toEqual(["a.mcap", "b.bag", "c.db3"]);
  });

  it("re-lettered rows after a removal drop the removed slot's stale offset text", async () => {
    useCompareStore.getState().setOffset("B", 1_500_000_000n);
    useCompareStore.getState().addFiles([makeFile("c.mcap")]); // a.mcap, b.bag, c.mcap
    renderButton();
    openPopover();
    fireEvent.click(await screen.findByTitle("Remove slot B")); // b.bag goes, c.mcap re-letters to B
    await waitFor(() => {
      expect(useCompareStore.getState().slots.map((s) => s.fileName)).toEqual(["a.mcap", "c.mcap"]);
    });
    // The row keyed "B" is reused; its offset input must show c.mcap's 0s, not b.bag's stale 1.5s.
    expect(screen.getByLabelText("Offset B (s)")).toHaveValue("0");
  });

  it("closes an open popover when a non-comparison source takes over, and it stays closed", () => {
    const root = renderButton();
    openPopover();
    expect(screen.getByText("a.mcap")).toBeTruthy();
    expect(screen.getByTestId("CompareSourcesButton")).toHaveAttribute("aria-expanded", "true");

    // Open a different file normally while the popover is open — the name changes for real.
    mockPlayerName = "normal.mcap";
    rerenderButton(root);
    expect(screen.queryByTestId("CompareSourcesButton")).toBeNull(); // session over, badge hidden
    expect(screen.queryByText("Add file…")).toBeNull();

    // Start a NEW comparison session: the badge returns, but the ghost popover must not.
    // (aria-expanded follows the AppBar sibling pattern: present only while open.)
    mockPlayerName = "Comparison: c.mcap";
    rerenderButton(root);
    expect(screen.getByTestId("CompareSourcesButton")).not.toHaveAttribute("aria-expanded");
    expect(screen.queryByText("a.mcap")).toBeNull(); // rows would render if the anchor survived
  });

  it("keeps the popover open across a same-session rebuild's undefined name blink", () => {
    const root = renderButton();
    openPopover();
    expect(screen.getByText("a.mcap")).toBeTruthy();

    // Offset/slot commits rebuild the player: defaultPlayerState() blinks name to undefined
    // between the old and new player — that must NOT close the popover.
    mockPlayerName = undefined;
    rerenderButton(root);
    mockPlayerName = "Comparison: a.mcap, b.bag";
    rerenderButton(root);

    expect(screen.getByText("a.mcap")).toBeTruthy(); // popover still open
    expect(screen.getByTestId("CompareSourcesButton")).toHaveAttribute("aria-expanded", "true");
  });

  it("Add file rejects unsupported extensions with a snackbar naming the file", async () => {
    const notes = makeFile("notes.txt");
    (showOpenFilePicker as jest.Mock).mockResolvedValue([{ getFile: async () => notes }]);
    renderButton();
    openPopover();
    fireEvent.click(await screen.findByText("Add file…"));
    const { enqueueSnackbar } = await import("notistack");
    await waitFor(() => {
      expect(enqueueSnackbar).toHaveBeenCalledWith(expect.stringContaining("notes.txt"), {
        variant: "error",
      });
    });
    expect(mockSelectSource).not.toHaveBeenCalled();
    expect(useCompareStore.getState().slots).toHaveLength(2);
  });

  it("Add file rejects an over-capacity pick without appending or rebuilding", async () => {
    // 2 slots occupied → room for 1; picking 2 valid files must fail visibly, not truncate.
    const { enqueueSnackbar } = await import("notistack");
    const picks = [makeFile("c.mcap"), makeFile("d.bag")];
    (showOpenFilePicker as jest.Mock).mockResolvedValue(
      picks.map((file) => ({ getFile: async () => file })),
    );
    renderButton();
    openPopover();
    fireEvent.click(await screen.findByText("Add file…"));
    await waitFor(() => {
      expect(enqueueSnackbar).toHaveBeenCalledWith(expect.stringContaining("at most 1"), {
        variant: "error",
      });
    });
    expect(mockSelectSource).not.toHaveBeenCalled();
    expect(useCompareStore.getState().slots.map((s) => s.fileName)).toEqual(["a.mcap", "b.bag"]);
  });

  it("Add file is disabled when every slot letter is in use", async () => {
    useCompareStore.getState().addFiles([makeFile("c.mcap")]);
    renderButton();
    openPopover();
    expect(await screen.findByRole("button", { name: "Add file…" })).toBeDisabled();
  });
});

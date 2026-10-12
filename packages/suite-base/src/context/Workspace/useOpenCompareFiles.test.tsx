/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook } from "@testing-library/react";
import { enqueueSnackbar } from "notistack";

import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import showOpenFilePicker from "@lichtblick/suite-base/util/showOpenFilePicker";

import { useOpenCompareFiles } from "./useOpenCompareFiles";

jest.mock("@lichtblick/suite-base/context/PlayerSelectionContext", () => ({
  usePlayerSelection: jest.fn(),
}));

jest.mock("@lichtblick/suite-base/util/showOpenFilePicker", () => jest.fn());

jest.mock("notistack", () => ({
  enqueueSnackbar: jest.fn(),
}));

function buildFile(name: string): File {
  return new File([name], name);
}

function setup(...files: File[]) {
  const fsHandles = files.map((file) => {
    return { getFile: jest.fn().mockResolvedValue(file) } as unknown as FileSystemFileHandle;
  });
  (showOpenFilePicker as jest.Mock).mockResolvedValue(fsHandles);
  return renderHook(() => useOpenCompareFiles());
}

describe("useOpenCompareFiles", () => {
  let selectSource: jest.Mock;

  beforeEach(() => {
    selectSource = jest.fn();
    (usePlayerSelection as jest.Mock).mockReturnValue({ selectSource });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("picks multiple files and selects the compare-files source", async () => {
    const fileA = buildFile("a.mcap");
    const fileB = buildFile("b.bag");
    const { result } = setup(fileA, fileB);

    await result.current();

    expect(showOpenFilePicker).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }));
    expect(selectSource).toHaveBeenCalledWith("compare-files", {
      type: "file",
      files: [fileA, fileB],
    });
  });

  it("snackbar-errors on unsupported extensions without selecting", async () => {
    const { result } = setup(buildFile("notes.txt"));

    await result.current();

    expect(selectSource).not.toHaveBeenCalled();
    expect(enqueueSnackbar).toHaveBeenCalledWith(expect.stringContaining("notes.txt"), {
      variant: "error",
    });
  });

  it("rejects more than three files", async () => {
    const { result } = setup(
      buildFile("a.mcap"),
      buildFile("b.mcap"),
      buildFile("c.mcap"),
      buildFile("d.mcap"),
    );

    await result.current();

    expect(selectSource).not.toHaveBeenCalled();
    expect(enqueueSnackbar).toHaveBeenCalledWith(expect.stringContaining("3"), {
      variant: "error",
    });
  });
});

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { globalRequestQueue } from "@lichtblick/suite-base/util/RequestQueue";
import { BasicBuilder } from "@lichtblick/test-builders";

import FetchReader from "./FetchReader";

// Mock the global request queue
jest.mock("@lichtblick/suite-base/util/RequestQueue", () => ({
  globalRequestQueue: {
    run: jest.fn(),
  },
}));

const mockGlobalRequestQueue = globalRequestQueue as jest.Mocked<typeof globalRequestQueue>;
const url = "https://example.com/data.mcap";

describe("FetchReader", () => {
  let mockFetch: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch = jest.spyOn(global, "fetch");

    // Default: globalRequestQueue.run passes through the function
    mockGlobalRequestQueue.run.mockImplementation(async (fn) => fn);
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  describe("constructor and fetch queueing", () => {
    it("passes options and abort signal to fetch when queued request executes", async () => {
      const options: RequestInit = {
        headers: { "Custom-Header": BasicBuilder.string() },
        method: "GET",
      };

      const mockResponse = new Response(new ReadableStream(), { status: 200 });
      mockFetch.mockResolvedValue(mockResponse);

      const reader = new FetchReader(url, options);

      // Execute the queued fetch
      const queuedFn = mockGlobalRequestQueue.run.mock.calls[0]![0];
      await queuedFn();

      expect(mockFetch).toHaveBeenCalledWith(url, {
        ...options,
        signal: expect.any(AbortSignal),
      });

      reader.destroy();
    });

    it("queues fetch request through globalRequestQueue", () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const runGlobalRequestQueueMock = mockGlobalRequestQueue.run;
      new FetchReader(url);

      // Verify fetch is queued, not called directly
      expect(runGlobalRequestQueueMock).toHaveBeenCalledTimes(1);
      expect(runGlobalRequestQueueMock).toHaveBeenCalledWith(expect.any(Function));
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("emits the x-foxglove-error-message header value on non-ok responses", async () => {
      mockGlobalRequestQueue.run.mockImplementation(async (fn) => await fn());
      mockFetch.mockResolvedValue(
        new Response(undefined, {
          status: 403,
          headers: { "x-foxglove-error-message": "This file is no longer available" },
        }),
      );

      const reader = new FetchReader(url);
      const errorPromise = new Promise<Error>((resolve) => {
        reader.on("error", resolve);
      });
      reader.read();

      const err = await errorPromise;
      expect(err.message).toBe("This file is no longer available");
    });

    it("falls back to the status-based message when the header is absent", async () => {
      mockGlobalRequestQueue.run.mockImplementation(async (fn) => await fn());
      mockFetch.mockResolvedValue(new Response(undefined, { status: 500 }));

      const reader = new FetchReader(url);
      const errorPromise = new Promise<Error>((resolve) => {
        reader.on("error", resolve);
      });
      reader.read();

      const err = await errorPromise;
      expect(err.message).toContain("failed with status 500");
      expect(err.message).not.toContain("This file is no longer available");
    });
  });
});

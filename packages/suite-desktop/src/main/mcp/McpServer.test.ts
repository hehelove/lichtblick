// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import net, { AddressInfo } from "net";

import { PlayerPresence } from "@lichtblick/suite-base/src/players/types";

import { McpServer, type McpServerSettings } from "./McpServer";
import { registerDataTools } from "./tools/dataTools";

const TOKEN = "test-token";

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => {
        resolve(port);
      });
    });
  });
}

async function isPortOpen(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

async function postRpc(
  port: number,
  token: string,
  body: unknown,
  sessionId?: string,
): Promise<Response> {
  return await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(sessionId != undefined ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function initialize(port: number, token: string): Promise<string | undefined> {
  const res = await postRpc(port, token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "jest", version: "0.0.0" },
    },
  });
  return res.headers.get("mcp-session-id") ?? undefined;
}

/** Extracts JSON-RPC messages from a JSON or SSE (text/event-stream) response body. */
async function readJsonRpcMessages(res: Response): Promise<unknown[]> {
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (contentType.includes("text/event-stream")) {
    return text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice("data:".length).trim()) as unknown);
  }
  const parsed = JSON.parse(text) as unknown;
  return Array.isArray(parsed) ? parsed : [parsed];
}

describe("McpServer", () => {
  let port: number;

  beforeEach(async () => {
    port = await getFreePort();
  });

  const makeServer = (settings: Partial<McpServerSettings> = {}): McpServer =>
    new McpServer({
      readSettings: () => ({ enabled: true, token: TOKEN, port, ...settings }),
    });

  it("does not listen when disabled", async () => {
    const server = makeServer({ enabled: false });
    await server.start();
    expect(await isPortOpen(port)).toBe(false);
    await server.stop();
  });

  it("rejects requests without or with a wrong bearer token", async () => {
    const server = makeServer();
    await server.start();

    const noAuth = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST" });
    expect(noAuth.status).toEqual(401);

    const wrongToken = await postRpc(port, "wrong-token", {
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    });
    expect(wrongToken.status).toEqual(401);

    await server.stop();
  });

  it("accepts an authorized initialize request", async () => {
    const server = makeServer();
    await server.start();

    const res = await postRpc(port, TOKEN, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "jest", version: "0.0.0" },
      },
    });
    expect(res.status).toEqual(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
    const messages = await readJsonRpcMessages(res);
    expect(messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ result: expect.anything() })]),
    );

    await server.stop();
  });

  it("answers the ping smoke tool with pong", async () => {
    const server = makeServer();
    await server.start();

    const sessionId = await initialize(port, TOKEN);
    expect(sessionId).toBeTruthy();

    const res = await postRpc(
      port,
      TOKEN,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "ping", arguments: {} },
      },
      sessionId,
    );
    expect(res.status).toEqual(200);

    const messages = (await readJsonRpcMessages(res)) as Array<{
      result?: { content?: Array<{ type: string; text: string }> };
    }>;
    const hasPong = messages.some((msg) =>
      (
        msg.result?.content?.some((item) => item.type === "text" && item.text === "pong") ?? false
      ),
    );
    expect(hasPong).toBe(true);

    await server.stop();
  });

  it("serves a registered data tool through the real SDK call path", async () => {
    const server = makeServer();
    registerDataTools(server, {
      getState: () => ({
        presence: PlayerPresence.PRESENT,
        playerName: "rosbridge",
        topics: [{ name: "/tf", schemaName: "std_msgs/String" }],
        datatypes: {
          "std_msgs/String": { name: "std_msgs/String", definitions: [{ name: "data", type: "string" }] },
        },
      }),
    });
    await server.start();

    const sessionId = await initialize(port, TOKEN);
    // get_schema takes a zod-shaped input, so this exercises the SDK's call-time input validation.
    const res = await postRpc(
      port,
      TOKEN,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_schema", arguments: { schemaName: "std_msgs/String" } },
      },
      sessionId,
    );
    expect(res.status).toEqual(200);

    const messages = (await readJsonRpcMessages(res)) as Array<{
      result?: { content?: Array<{ type: string; text: string }>; isError?: boolean };
    }>;
    const result = messages.find((msg) => msg.result?.content != undefined)?.result;
    expect(result?.isError).toEqual(undefined); // the zod input shape parsed through the real SDK
    expect(result != undefined ? JSON.parse(result.content![0]!.text) : undefined).toEqual({
      name: "std_msgs/String",
      definitions: [{ name: "data", type: "string" }],
    });

    await server.stop();
  });

  it("start() is idempotent", async () => {
    const server = makeServer();
    await server.start();
    await expect(server.start()).resolves.toBeUndefined();
    expect(server.isListening()).toBe(true);
    expect(await isPortOpen(port)).toBe(true);
    await server.stop();
    expect(server.isListening()).toBe(false);
  });

  it("survives a busy port without throwing and allows a later restart", async () => {
    const squatter = net.createServer(() => {});
    await new Promise<void>((resolve) => {
      squatter.listen(port, "127.0.0.1", () => {
        resolve();
      });
    });

    const server = makeServer();
    await expect(server.start()).resolves.toBeUndefined(); // logs the failure, does not throw
    expect(server.isListening()).toBe(false); // honest signal despite enabled settings
    // The listen failure is expected and logged via log.error(); acknowledge and clear it.
    expect(console.error).toHaveBeenCalled();
    (console.error as jest.Mock).mockReset();
    expect(await isPortOpen(port)).toBe(true); // still the squatter

    squatter.close();
    await new Promise<void>((resolve) => {
      squatter.once("close", () => {
        resolve();
      });
    });

    await server.start(); // #started was reset, so a retry binds
    expect(await isPortOpen(port)).toBe(true);
    expect(await initialize(port, TOKEN)).toBeTruthy();
    await server.stop();
  });

  it("releases the port on stop()", async () => {
    const server = makeServer();
    await server.start();
    expect(await isPortOpen(port)).toBe(true);
    await server.stop();
    expect(await isPortOpen(port)).toBe(false);
  });

  it("returns 404 for paths other than /mcp", async () => {
    const server = makeServer();
    await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toEqual(404);

    await server.stop();
  });
});

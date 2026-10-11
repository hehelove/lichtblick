// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import {
  McpServer as SdkMcpServer,
  type ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AnySchema, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { isInitializeRequest, type ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { randomBytes, randomUUID } from "crypto";
import http from "http";

import Logger from "@lichtblick/log";
import { AppSetting } from "@lichtblick/suite-base/src/AppSetting";

import { getAppSetting, setAppSetting } from "../settings";

const log = Logger.getLogger(__filename);

export const DEFAULT_MCP_PORT = 7333;

export type McpServerSettings = {
  enabled: boolean;
  token: string;
  port: number;
};

export type McpServerOptions = {
  /** Reads the settings the server should use; overridable for tests to avoid touching electron. */
  readSettings?: () => McpServerSettings;
};

function defaultReadSettings(): McpServerSettings {
  const enabled = getAppSetting<boolean>(AppSetting.MCP_ENABLED) ?? false;
  let token = getAppSetting<string>(AppSetting.MCP_TOKEN);
  if (token == undefined || token.length === 0) {
    token = randomBytes(32).toString("hex");
    setAppSetting(AppSetting.MCP_TOKEN, token);
  }
  const port = getAppSetting<number>(AppSetting.MCP_PORT) ?? DEFAULT_MCP_PORT;
  return { enabled, token, port };
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const chunks: string[] = [];
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const body = chunks.join("");
      if (body.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on("error", reject);
  });
}

function sendJsonRpcError(
  res: http.ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  if (!res.headersSent) {
    res.writeHead(status, { "content-type": "application/json" });
  }
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

type McpSession = {
  server: SdkMcpServer;
  transport: StreamableHTTPServerTransport;
};

export class McpServer {
  #started: boolean = false;
  #readSettings: () => McpServerSettings;
  #httpServer?: http.Server;
  #sessions = new Map<string, McpSession>();
  #toolRegistrations: Array<(server: SdkMcpServer) => void> = [];

  public constructor({ readSettings = defaultReadSettings }: McpServerOptions = {}) {
    this.#readSettings = readSettings;

    // Smoke test tool proving the registerTool chain works end-to-end; real tools arrive in Task 3+.
    this.registerTool("ping", { description: "Responds with pong" }, () => ({
      content: [{ type: "text", text: "pong" }],
    }));
  }

  public async start(): Promise<void> {
    if (this.#started) {
      log.info("McpServer already running");
      return;
    }
    this.#started = true;

    const settings = this.#readSettings();
    if (!settings.enabled) {
      log.info("MCP server is disabled");
      return;
    }

    try {
      await this.#listen(settings);
      log.info(`MCP server listening on http://127.0.0.1:${settings.port}/mcp`);
    } catch (err: unknown) {
      // A busy port or another listen failure must not take the app down.
      this.#started = false;
      log.error(`Failed to start MCP server on port ${settings.port}: ${err}`);
    }
  }

  public async stop(): Promise<void> {
    this.#started = false;

    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    for (const { transport } of sessions) {
      try {
        await transport.close();
      } catch (err: unknown) {
        log.warn(`Error closing MCP session: ${err}`);
      }
    }

    const httpServer = this.#httpServer;
    this.#httpServer = undefined;
    if (httpServer != undefined) {
      httpServer.closeIdleConnections();
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => {
        httpServer.close(() => {
          resolve();
        });
      });
    }
  }

  /**
   * Registers a tool for future MCP sessions. Mirrors the SDK's
   * `McpServer.registerTool(name, config, cb)` signature.
   *
   * Note: the SDK rejects capability registration on a connected server, so tools
   * registered while sessions are live only apply to sessions created afterwards.
   */
  public registerTool<
    OutputArgs extends ZodRawShapeCompat | AnySchema,
    InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
  >(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: InputArgs;
      outputSchema?: OutputArgs;
      annotations?: ToolAnnotations;
      _meta?: Record<string, unknown>;
    },
    cb: ToolCallback<InputArgs>,
  ): void {
    this.#toolRegistrations.push((server: SdkMcpServer) => {
      server.registerTool(name, config, cb);
    });
  }

  async #listen(settings: McpServerSettings): Promise<void> {
    const httpServer = http.createServer((req, res) => {
      void this.#handleRequest(req, res, settings.token).catch((err: unknown) => {
        log.error(`MCP request failed: ${err}`);
        sendJsonRpcError(res, 500, -32603, "Internal error");
      });
    });
    httpServer.on("error", (err) => {
      log.error(`MCP http server error: ${err}`);
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(settings.port, "127.0.0.1", () => {
        httpServer.off("error", reject);
        resolve();
      });
    });

    this.#httpServer = httpServer;
  }

  async #handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    token: string,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/mcp") {
      res.writeHead(404);
      res.end();
      return;
    }

    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { "www-authenticate": "Bearer" });
      res.end();
      return;
    }

    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    if (req.method === "POST") {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJsonRpcError(res, 400, -32700, "Parse error: Invalid JSON-RPC message");
        return;
      }

      let session = sessionId != undefined ? this.#sessions.get(sessionId) : undefined;
      if (session == undefined && body != undefined && isInitializeRequest(body)) {
        session = await this.#createSession();
      }
      if (session == undefined) {
        // Not an initialize request and no (known) session id.
        if (sessionId != undefined) {
          res.writeHead(404);
          res.end();
        } else {
          sendJsonRpcError(res, 400, -32000, "Bad Request: Mcp-Session-Id header is required");
        }
        return;
      }
      await session.transport.handleRequest(req, res, body);
      return;
    }

    if (sessionId == undefined) {
      res.writeHead(req.method === "GET" ? 405 : 400);
      res.end();
      return;
    }

    const session = this.#sessions.get(sessionId);
    if (session == undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    await session.transport.handleRequest(req, res);
  }

  async #createSession(): Promise<McpSession> {
    const server = new SdkMcpServer({ name: "lichtblick", version: "0.0.0" });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        this.#sessions.set(sessionId, session);
      },
      onsessionclosed: (sessionId) => {
        this.#sessions.delete(sessionId);
      },
    });
    transport.onerror = (err) => {
      log.warn(`MCP transport error: ${err.message}`);
    };

    const session = { server, transport };

    // Tools must be registered before connect(): the SDK rejects capability
    // registrations on a connected server.
    for (const register of this.#toolRegistrations) {
      register(server);
    }

    await server.connect(transport);
    return session;
  }

  static #instance?: McpServer;
  public static Instance(): McpServer {
    return (McpServer.#instance ??= new McpServer());
  }
}

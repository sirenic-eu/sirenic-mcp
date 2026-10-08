/**
 * The connection to the Sirenic MCP server (streamable HTTP). Anonymous rail and x402 rail: `/mcp`.
 * API key rail: `/mcp/connecteur` with `Authorization: Bearer <key>` (the key never travels in tool arguments).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { CLIENT_NAME, PACKAGE_VERSION, USER_AGENT } from "./version.js";

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface RemoteOptions {
  baseUrl: URL;
  apiKey?: string;
  /** Injected in tests; the global fetch otherwise. */
  fetch?: FetchLike;
  /** initialize and tools/list. */
  listTimeoutMs?: number;
  /** tools/call: the server allows a paid call up to its longest sold window plus settlement. */
  callTimeoutMs?: number;
}

export const LIST_TIMEOUT_MS = 10_000;
export const CALL_TIMEOUT_MS = 300_000;

export interface RemoteList {
  tools: Tool[];
  instructions?: string;
  serverVersion?: string;
}

/** What went wrong on the way to the server, before any tool result. */
export type TransportFailure =
  | { kind: "http"; status: number }
  | { kind: "timeout" }
  | { kind: "network"; detail: string }
  | { kind: "protocol"; detail: string };

export function classifyFailure(error: unknown): TransportFailure {
  if (error instanceof StreamableHTTPError && typeof error.code === "number" && error.code > 0) return { kind: "http", status: error.code };
  if (error instanceof McpError) {
    if (error.code === ErrorCode.RequestTimeout) return { kind: "timeout" };
    return { kind: "protocol", detail: error.message };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return { kind: "network", detail };
}

export class RemoteServer {
  readonly endpoint: URL;
  private client: Client | undefined;
  private readonly options: RemoteOptions;

  constructor(options: RemoteOptions) {
    this.options = options;
    this.endpoint = new URL(options.apiKey ? "/mcp/connecteur" : "/mcp", options.baseUrl);
  }

  private headers(): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
    };
  }

  /** initialize, once; a new attempt after a failure. */
  async connect(): Promise<Client> {
    if (this.client) return this.client;
    const transport = new StreamableHTTPClientTransport(this.endpoint, {
      requestInit: { headers: this.headers() },
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
    const client = new Client({ name: CLIENT_NAME, version: PACKAGE_VERSION });
    try {
      await client.connect(transport, { timeout: this.options.listTimeoutMs ?? LIST_TIMEOUT_MS });
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
    this.client = client;
    return client;
  }

  async listTools(): Promise<RemoteList> {
    const client = await this.connect();
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: this.options.listTimeoutMs ?? LIST_TIMEOUT_MS });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    const instructions = client.getInstructions();
    const serverVersion = client.getServerVersion()?.version;
    return { tools, ...(instructions ? { instructions } : {}), ...(serverVersion ? { serverVersion } : {}) };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const client = await this.connect();
    return (await client.callTool({ name, arguments: args }, undefined, {
      timeout: this.options.callTimeoutMs ?? CALL_TIMEOUT_MS,
    })) as CallToolResult;
  }

  /** Forgets the connection: the next call opens a new one. */
  async reset(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    await client?.close().catch(() => undefined);
  }

  async close(): Promise<void> {
    await this.reset();
  }
}

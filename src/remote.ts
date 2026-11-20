/**
 * The hosted Sirenic MCP server's tool list (streamable HTTP, `/mcp`, anonymous and free): read at startup to bring the
 * served list up to date (catalogue.ts, `refreshCatalogue`), never to make a call. No key and no payment ever travel
 * here: the API key goes to the REST API only (rest.ts).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { RemoteList } from "./catalogue.js";
import { CLIENT_NAME, PACKAGE_VERSION, USER_AGENT } from "./version.js";

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface RemoteOptions {
  baseUrl: URL;
  /** Injected in tests; the global fetch otherwise. */
  fetch?: FetchLike;
  /** initialize and tools/list. */
  listTimeoutMs?: number;
}

export const LIST_TIMEOUT_MS = 10_000;

export class RemoteServer {
  readonly endpoint: URL;
  private client: Client | undefined;
  private readonly options: RemoteOptions;

  constructor(options: RemoteOptions) {
    this.options = options;
    this.endpoint = new URL("/mcp", options.baseUrl);
  }

  /** initialize, once; a new attempt after a failure. */
  async connect(): Promise<Client> {
    if (this.client) return this.client;
    const transport = new StreamableHTTPClientTransport(this.endpoint, {
      requestInit: { headers: { "User-Agent": USER_AGENT } },
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

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    await client?.close().catch(() => undefined);
  }
}

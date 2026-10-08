/**
 * A simulated Sirenic MCP server, behind an injected fetch: JSON-RPC over HTTP (JSON responses, no session),
 * the way https://api.sirenic.eu/mcp answers. Only the endpoints given at creation answer; any other address is
 * refused (no test reaches the network, test/setup-no-network.ts refuses the rest).
 */
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { FetchLike } from "../../src/remote.js";

export const BASE = "https://api.sirenic.eu";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
}

/** What a tools/call answers: a tool result, an HTTP status before any result, or a broken connection. */
export type CallAnswer = { result: CallToolResult } | { status: number } | { networkError: string };

export interface FakeRemoteOptions {
  tools: Tool[];
  instructions?: string;
  serverVersion?: string;
  /** Endpoints that answer, e.g. https://api.sirenic.eu/mcp; every other address is refused. */
  endpoints?: string[];
  /** HTTP status of every request to an endpoint (401 for a refused key...), or undefined to answer. */
  refuseWith?: (url: string, headers: Record<string, string>) => number | undefined;
  onCall?: (name: string, args: Record<string, unknown>, headers: Record<string, string>) => CallAnswer;
}

export class UnregisteredAddress extends Error {}

export function fakeRemote(options: FakeRemoteOptions): { fetch: FetchLike; requests: RecordedRequest[]; calls: () => RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const endpoints = new Set(options.endpoints ?? [`${BASE}/mcp`, `${BASE}/mcp/connecteur`]);
  const fetch: FetchLike = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!endpoints.has(url)) throw new UnregisteredAddress(`unregistered address: ${url}`);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as RecordedRequest["body"] & { id?: number; jsonrpc?: string }) : undefined;
    requests.push({ url, method, headers, ...(body ? { body } : {}) });
    const refused = options.refuseWith?.(url, headers);
    if (refused !== undefined) return new Response(JSON.stringify({ error: "refused" }), { status: refused, headers: { "content-type": "application/json" } });
    if (method === "GET") return new Response(null, { status: 405 });
    if (method === "DELETE") return new Response(null, { status: 405 });
    const message = body as { id?: number; method?: string; params?: Record<string, unknown> };
    if (message.id === undefined) return new Response(null, { status: 202 });
    const reply = (result: unknown) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }), { status: 200, headers: { "content-type": "application/json" } });
    switch (message.method) {
      case "initialize":
        return reply({
          protocolVersion: (message.params?.protocolVersion as string) ?? "2025-06-18",
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "sirenic", version: options.serverVersion ?? "1.1.0" },
          ...(options.instructions ? { instructions: options.instructions } : {}),
        });
      case "tools/list":
        return reply({ tools: options.tools });
      case "tools/call": {
        const params = message.params as { name: string; arguments?: Record<string, unknown> };
        const answer = options.onCall?.(params.name, params.arguments ?? {}, headers) ?? { status: 500 };
        if ("networkError" in answer) throw new TypeError(`fetch failed (${answer.networkError})`);
        if ("status" in answer) return new Response("Too many requests", { status: answer.status });
        return reply(answer.result);
      }
      default:
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
    }
  };
  return { fetch, requests, calls: () => requests.filter((r) => r.body?.method === "tools/call") };
}

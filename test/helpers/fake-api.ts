/**
 * A simulated Sirenic REST API behind an injected fetch: GET under /v1/ of https://api.sirenic.eu answers what the test
 * says, and, when a tool list is given, /mcp answers initialize and tools/list (the hosted list, read at startup to
 * refresh the catalogue). Any other address is refused (no test reaches the network, test/setup-no-network.ts refuses
 * the rest).
 */
import type { FetchLike } from "../../src/remote.js";
import { fakeRemote, UnregisteredAddress, type FakeRemoteOptions } from "./fake-remote.js";

export const BASE = "https://api.sirenic.eu";

export interface ApiRequest {
  url: string;
  /** Path and query, as sent. */
  path: string;
  method: string;
  headers: Record<string, string>;
  redirect: RequestRedirect | undefined;
}

/** What the API answers: a status with a body and headers, a broken connection, or no answer until the call is cut. */
export type ApiReply =
  | { status: number; json?: unknown; text?: string; bytes?: Uint8Array; contentType?: string; headers?: Record<string, string> }
  | { networkError: string }
  | { hang: true };

export interface FakeApiOptions {
  onRequest?: (request: ApiRequest, n: number) => ApiReply | Promise<ApiReply>;
  /** The hosted MCP server's tool list; absent: /mcp is unreachable. */
  mcp?: FakeRemoteOptions;
}

export function fakeApi(options: FakeApiOptions): { fetch: FetchLike; requests: ApiRequest[]; mcp: ReturnType<typeof fakeRemote> | undefined } {
  const requests: ApiRequest[] = [];
  const mcp = options.mcp ? fakeRemote({ ...options.mcp, endpoints: [`${BASE}/mcp`] }) : undefined;
  const fetch: FetchLike = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `${BASE}/mcp`) {
      if (!mcp) throw new UnregisteredAddress(`unregistered address: ${url}`);
      return mcp.fetch(input, init);
    }
    const parsed = new URL(url);
    if (parsed.origin !== BASE || !parsed.pathname.startsWith("/v1/")) throw new UnregisteredAddress(`unregistered address: ${url}`);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const request: ApiRequest = { url, path: `${parsed.pathname}${parsed.search}`, method: init?.method ?? "GET", headers, redirect: init?.redirect };
    requests.push(request);
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const reply = (await options.onRequest?.(request, requests.length)) ?? { status: 500, json: { error: "not_simulated" } };
    if ("networkError" in reply) throw new TypeError(`fetch failed (${reply.networkError})`);
    if ("hang" in reply) {
      return new Promise<Response>((_resolve, reject) => {
        const cut = () => reject(new DOMException("aborted", "AbortError"));
        if (signal?.aborted) cut();
        signal?.addEventListener("abort", cut, { once: true });
      });
    }
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const responseHeaders = new Headers(reply.headers ?? {});
    let body: BodyInit | null = null;
    if (reply.json !== undefined) {
      body = JSON.stringify(reply.json);
      if (!responseHeaders.has("content-type")) responseHeaders.set("content-type", reply.contentType ?? "application/json; charset=utf-8");
    } else if (reply.text !== undefined) {
      body = reply.text;
      if (!responseHeaders.has("content-type") && reply.contentType) responseHeaders.set("content-type", reply.contentType);
    } else if (reply.bytes !== undefined) {
      body = reply.bytes;
      if (!responseHeaders.has("content-type") && reply.contentType) responseHeaders.set("content-type", reply.contentType);
    }
    return new Response(reply.status === 204 || reply.status === 304 ? null : body, { status: reply.status, headers: responseHeaders });
  };
  return { fetch, requests, mcp };
}

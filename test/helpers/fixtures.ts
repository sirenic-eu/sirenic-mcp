/** Recorded fixtures (test/fixtures) and the shipped snapshot, read once. */
import { readFileSync } from "node:fs";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { readSnapshot } from "../../src/snapshot.js";
import type { ApiReply } from "./fake-api.js";

function json<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as T;
}

/** initialize and tools/list of https://api.sirenic.eu/mcp, recorded on 2026-10-08 (server 1.1.0, without _meta): a
 *  server older than this package, without call templates. */
export const REMOTE = json<{ recorded_at: string; initialize: { instructions?: string; serverInfo: { version: string } }; tools: Tool[] }>(
  "distant-2026-10-08.json",
);

interface RecordedAnswer {
  request: { method: string; path: string; accept: string };
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Two unpaid answers of the REST API, read on 2026-11-19 with the package's User-Agent: $0.002 and $0.10 quotes (402,
 *  the quote in PAYMENT-REQUIRED, the free key offer in the body). Free reads, nothing paid. */
export const DEVIS = json<{ recorded_at: string; user_agent: string; answers: { search_french_companies: RecordedAnswer; get_french_company_default_risk: RecordedAnswer } }>(
  "devis-rest-2026-11-19.json",
);

/** A recorded 402 as the simulated API serves it. */
export function quoteReply(name: keyof typeof DEVIS.answers): ApiReply {
  const a = DEVIS.answers[name];
  return { status: a.status, json: a.body, headers: { "payment-required": a.headers["payment-required"]! } };
}

/** The quote of a recorded 402, decoded. */
export function recordedQuote(name: keyof typeof DEVIS.answers): { x402Version: number; accepts: Array<{ amount: string; asset: string }> } {
  return JSON.parse(Buffer.from(DEVIS.answers[name].headers["payment-required"]!, "base64").toString("utf8"));
}

/** The snapshot shipped with the package. */
export const SNAPSHOT = readSnapshot();

/** Data as the API sends it (DANONE, a legal person: no personal data). */
export function dataReply(body: Record<string, unknown> = { siren: "552032534", denomination: "DANONE" }, headers: Record<string, string> = {}): ApiReply {
  return { status: 200, json: body, headers };
}

/** An error of the API (JSON with its code). */
export function errorReply(status: number, body: Record<string, unknown>): ApiReply {
  return { status, json: body };
}

/** A PAYMENT-RESPONSE header value (base64 JSON), as the API's gate writes it. */
export function paymentResponseHeader(receipt: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(receipt)).toString("base64");
}

/** Recorded fixtures (test/fixtures, 2026-10-08) and the shipped snapshot, read once. */
import { readFileSync } from "node:fs";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { readSnapshot } from "../../src/snapshot.js";

function json<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as T;
}

/** initialize and tools/list of https://api.sirenic.eu/mcp, recorded on 2026-10-08 (server 1.1.0, without _meta). */
export const REMOTE = json<{ recorded_at: string; initialize: { instructions?: string; serverInfo: { version: string } }; tools: Tool[] }>(
  "distant-2026-10-08.json",
);

/** Two unpaid tools/call answers recorded the same day: $0.002 and $0.10 quotes. */
export const QUOTES = json<{ search_french_companies: CallToolResult; get_french_company_default_risk: CallToolResult }>("devis-2026-10-08.json");

/** The snapshot shipped with the package (server 1.2.0 with _meta). */
export const SNAPSHOT = readSnapshot();

/** A tool result as the server sends data (DANONE, a legal person: no personal data). */
export function dataResult(payload: Record<string, unknown> = { siren: "552032534", denomination: "DANONE" }, meta?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: { payment_required: false, resultat: payload },
    isError: false,
    ...(meta ? { _meta: meta } : {}),
  };
}

/** A tool error as the server sends it (resultat.statut_http). */
export function serverError(status: number, body: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    structuredContent: { payment_required: false, resultat: { statut_http: status, ...body } },
    isError: true,
  };
}

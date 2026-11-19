/**
 * Errors this package produces itself, as a closed list, in `structuredContent.resultat.error`. Answers of the Sirenic
 * REST API (a 503 `amont_indisponible`, a 401 for a refused key, a 402 `credits_insuffisants`, a 429...) reach the client
 * as the API served them, with `statut_http`. A paid call with no rail is not an error: it answers
 * `payment_required: true` with the API's quote (`paymentRequired` in server.ts), `isError` false.
 *
 * A tool result keeps the shape of the tool's output schema (`payment_required`, `resultat`): an MCP client
 * validates structured content against it, even on an error.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const ERROR_CODES = [
  /** The arguments do not fit the tool's input schema, or a path argument is empty, "." or "..": nothing was sent. */
  "argument_invalide",
  /** The tool's call template gives no request for valid arguments: a fault of Sirenic, nothing was sent. */
  "gabarit_invalide",
  /** The quote is above the cap per call or what is left of the session cap: nothing is signed. */
  "plafond_depasse",
  /** The signed payment was refused (a new quote, or a settlement refused): nothing was settled, nothing is replayed. */
  "paiement_refuse",
  /** A signed payment was sent and its outcome is unknown (connection broken, cancelled, an answer that is not the API's,
   *  a settlement the API could not confirm): it may have been settled, it counts against the session cap, nothing is
   *  replayed. */
  "reglement_incertain",
  /** The client cancelled the call before any signed payment was sent: nothing was paid. */
  "appel_annule",
  /** The Sirenic API could not be reached (network error, timeout) before any signed payment was sent. */
  "service_injoignable",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export function packageError(code: ErrorCode, message: string, details: Record<string, unknown> = {}): CallToolResult {
  const body = { error: code, message, ...details };
  return {
    content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
    structuredContent: { payment_required: false, resultat: body },
    isError: true,
  };
}

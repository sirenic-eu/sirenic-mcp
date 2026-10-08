/**
 * Errors this package produces itself, as a closed list, in `structuredContent.resultat.error`. Errors produced by the
 * Sirenic server (a 503 `amont_indisponible`, a 401 `compte_requis`, a 402 `credits_insuffisants`...) reach the client
 * unchanged. A paid call with no rail is not an error: it answers `payment_required: true` with the server's quote
 * (`paymentRequired` in server.ts), `isError` false.
 *
 * A tool result keeps the shape of the tool's output schema (`payment_required`, `resultat`): an MCP client
 * validates structured content against it, even on an error.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const ERROR_CODES = [
  /** The quote is above the cap per call or what is left of the session cap: nothing is signed. */
  "plafond_depasse",
  /** The server answered the signed payment with a new quote (payment rejected): nothing is replayed. */
  "paiement_refuse",
  /** The connection broke after a signed payment was sent: the server may have settled it, nothing is replayed. */
  "reglement_incertain",
  /** The server refused SIRENIC_API_KEY (401): never a silent fallback to the wallet. */
  "cle_invalide",
  /** The account of SIRENIC_API_KEY is suspended or closed (403). */
  "compte_inactif",
  /** The server rate limited this address (429). */
  "trop_de_requetes",
  /** The Sirenic server could not be reached (network, timeout, 5xx): nothing is signed. */
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

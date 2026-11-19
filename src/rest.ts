/**
 * The call of a tool, made by the package itself on the Sirenic REST API: the request the shared analyser
 * (appel-outil.ts) gives for the tool's call template and the arguments, sent to the API's origin, and the answer read
 * back into a tool result the way the hosted Sirenic MCP server renders it (JSON data or error, PDF in base64, Markdown
 * as is). This module holds the only HTTP call of the package outside the MCP client transport (remote.ts).
 *
 * What travels: `Accept` from the template, `User-Agent: sirenic-mcp-npm/<version>` (the API counts the package's sales
 * apart), and either `X-Api-Key` (key rail) or `PAYMENT-SIGNATURE` (x402 rail, a quote signed by server.ts). Only GET,
 * only under /v1/ of the configured origin; a redirect is never followed (a 3xx comes back as an error).
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import type { RenduAppel } from "./appel-outil.js";
import type { FetchLike } from "./remote.js";
import { USER_AGENT } from "./version.js";
import { isQuote } from "./wallet.js";

/** A paid call may take up to the API's longest sold window plus settlement. */
export const CALL_TIMEOUT_MS = 300_000;
/** The text of an error answer that is not JSON is cut beyond this many characters (the cut is said); a 2xx never is. */
export const ERROR_TEXT_LIMIT = 2_000;

export interface ApiOptions {
  baseUrl: URL;
  /** Key rail only: sent as X-Api-Key on every call. */
  apiKey?: string;
  /** Injected in tests; the global fetch otherwise. */
  fetch?: FetchLike;
  callTimeoutMs?: number;
}

/** An answer of the API (or of whatever answered at its address), read whole. */
export interface ApiAnswer {
  status: number;
  contentType: string;
  headers: Headers;
  bytes: Uint8Array;
}

export type Sent =
  | { kind: "answer"; answer: ApiAnswer }
  /** The client's signal fired: the request was not sent, or was cut. */
  | { kind: "cancelled" }
  | { kind: "unreachable"; detail: string };

export class InvariantError extends Error {}

export class SirenicApi {
  constructor(private readonly options: ApiOptions) {}

  /** The URL of a request the analyser gave: the API's origin, a path under /v1/; anything else is a broken invariant. */
  url(chemin: string): URL {
    if (!chemin.startsWith("/v1/")) throw new InvariantError("request path outside /v1/");
    const url = new URL(chemin, this.options.baseUrl);
    if (url.origin !== this.options.baseUrl.origin || !url.pathname.startsWith("/v1/")) throw new InvariantError("request outside the API's origin");
    return url;
  }

  /**
   * Sends one GET. `payment`: the PAYMENT-SIGNATURE header value of a signed quote (x402 rail). `signal`: the client's
   * cancellation, tied to the whole exchange (a cancelled call is cut, the API does not settle for a client that left).
   */
  async send(chemin: string, accept: string, payment: string | undefined, signal?: AbortSignal): Promise<Sent> {
    const url = this.url(chemin);
    const headers: Record<string, string> = { Accept: accept, "User-Agent": USER_AGENT };
    if (payment !== undefined) headers["PAYMENT-SIGNATURE"] = payment;
    else if (this.options.apiKey !== undefined) headers["X-Api-Key"] = this.options.apiKey;
    if (signal?.aborted) return { kind: "cancelled" };
    const timeout = AbortSignal.timeout(this.options.callTimeoutMs ?? CALL_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const fetchFn = this.options.fetch ?? globalThis.fetch;
    try {
      const response = await fetchFn(url, { method: "GET", headers, redirect: "manual", signal: combined });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { kind: "answer", answer: { status: response.status, contentType: response.headers.get("content-type") ?? "", headers: response.headers, bytes } };
    } catch (error) {
      if (signal?.aborted) return { kind: "cancelled" };
      if (timeout.aborted) return { kind: "unreachable", detail: "timeout" };
      return { kind: "unreachable", detail: error instanceof Error ? error.message : String(error) };
    }
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** structuredContent must be an object: a body that is not one is wrapped, as the hosted server does. */
function asObject(v: unknown): Record<string, unknown> {
  return isObject(v) ? v : { valeur: v };
}

export function textOf(answer: ApiAnswer): string {
  return new TextDecoder().decode(answer.bytes);
}

/** The body as JSON, when the content type says JSON and the text parses. */
export function jsonOf(answer: ApiAnswer): { ok: true; value: unknown } | { ok: false } {
  if (!/\bjson\b/i.test(answer.contentType)) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(textOf(answer)) as unknown };
  } catch {
    return { ok: false };
  }
}

/** The quote of a 402: the PAYMENT-REQUIRED header decoded (the body is only a welcome message). */
export function quoteOf(answer: ApiAnswer): PaymentRequired | undefined {
  if (answer.status !== 402) return undefined;
  const header = answer.headers.get("payment-required");
  if (!header) return undefined;
  try {
    const quote = decodePaymentRequiredHeader(header);
    return isQuote(quote) ? quote : undefined;
  } catch {
    return undefined;
  }
}

/** The settlement receipt of a paid answer: PAYMENT-RESPONSE decoded, only when it says success (a failed settlement
 *  also carries the header, with success false: that is no receipt). */
export function receiptOf(answer: ApiAnswer): unknown {
  const header = answer.headers.get("payment-response");
  if (!header) return undefined;
  try {
    const receipt = decodePaymentResponseHeader(header);
    return (receipt as { success?: unknown }).success === true ? receipt : undefined;
  } catch {
    return undefined;
  }
}

/** The error body of the API: JSON, an object, with a string `error` code. Whatever else answered (a proxy page, a 502 or
 *  504 of the front server, JSON without a code) is not the API's word. */
export function apiErrorCode(answer: ApiAnswer): string | undefined {
  const body = jsonOf(answer);
  return body.ok && isObject(body.value) && typeof body.value.error === "string" ? body.value.error : undefined;
}

/** The body of an answer, as the tool result carries it: the JSON, or the text (cut on an error beyond the limit). */
function bodyOf(answer: ApiAnswer, failed: boolean): unknown {
  const json = jsonOf(answer);
  if (json.ok) return json.value;
  const text = textOf(answer);
  if (failed && text.length > ERROR_TEXT_LIMIT) return { texte: text.slice(0, ERROR_TEXT_LIMIT), texte_tronque: true, longueur: text.length };
  return { texte: text, ...(answer.contentType ? { content_type: answer.contentType } : {}) };
}

function pdfFilename(answer: ApiAnswer, tool: string): string {
  const disposition = answer.headers.get("content-disposition") ?? "";
  const named = /filename="?([A-Za-z0-9._-]{1,200})"?/.exec(disposition)?.[1];
  return named ?? `${tool}.pdf`;
}

/**
 * The tool result of an answer that is not a quote: data (JSON, a PDF in base64, Markdown as is) or an error of the API,
 * with `statut_http`, `isError` on any status outside 2xx.
 */
export function renderAnswer(answer: ApiAnswer, rendu: RenduAppel, tool: string): CallToolResult {
  const ok = answer.status >= 200 && answer.status < 300;
  if (answer.status === 200 && (rendu === "pdf" || rendu === "json-ou-pdf") && /\bpdf\b/i.test(answer.contentType)) {
    const pdf = Buffer.from(answer.bytes);
    return {
      content: [{ type: "text", text: JSON.stringify({ filename: pdfFilename(answer, tool), content_type: "application/pdf", pdf_base64: pdf.toString("base64") }) }],
      isError: false,
    };
  }
  if (answer.status === 200 && rendu === "markdown" && /\btext\/markdown\b/i.test(answer.contentType)) {
    return { content: [{ type: "text", text: textOf(answer) }], isError: false };
  }
  const body = bodyOf(answer, !ok);
  const resultat = ok ? asObject(body) : { statut_http: answer.status, ...asObject(body) };
  return {
    content: [{ type: "text", text: JSON.stringify(ok ? body : resultat, null, 2) }],
    structuredContent: { payment_required: false, resultat },
    isError: !ok,
  };
}

/** The body of a 402 quote: its free key offer (`free_tier`, in the form the API serves to this package) and its
 *  pricing note, when there are. */
export function quoteBody(answer: ApiAnswer): { freeTier?: Record<string, unknown>; pricingNote?: string } {
  const body = jsonOf(answer);
  if (!body.ok || !isObject(body.value)) return {};
  const { free_tier: freeTier, pricing_note: pricingNote } = body.value;
  return {
    ...(isObject(freeTier) ? { freeTier } : {}),
    ...(typeof pricingNote === "string" && pricingNote !== "" ? { pricingNote } : {}),
  };
}

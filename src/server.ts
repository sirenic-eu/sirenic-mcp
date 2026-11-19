/**
 * The local MCP server (stdio side). Its tools are defined in this repository (catalogue/instantane.json, catalogue.ts);
 * each call reads its arguments through the tool's input schema (arguments.ts), turns them into a request by the tool's
 * call template (the shared analyser, appel-outil.ts) and calls the Sirenic REST API itself (rest.ts), which is the
 * paywall: the package never builds a quote and never knows a price it would apply. It pays with the API key, or signs
 * the quote the API returned with the local wallet, under the caps, and sends the same request again with the signature.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { PaymentRequired } from "@x402/core/types";
import { englishReason } from "./analyser-reasons.js";
import { requeteDeLOutil } from "./appel-outil.js";
import { readArguments } from "./arguments.js";
import { catalogueFromSnapshot, refreshCatalogue, withoutPaymentArguments, type Catalogue, type ServedTool } from "./catalogue.js";
import type { Config } from "./config.js";
import { packageError } from "./errors.js";
import { formatUsd } from "./money.js";
import type { RemoteServer } from "./remote.js";
import { apiErrorCode, InvariantError, jsonOf, quoteBody, quoteOf, receiptOf, renderAnswer, type ApiAnswer, type SirenicApi } from "./rest.js";
import { readSnapshot, type Snapshot } from "./snapshot.js";
import { PACKAGE_VERSION } from "./version.js";
import { quotePrice, Wallet, type Reservation } from "./wallet.js";

export interface SirenicServerOptions {
  config: Config;
  /** The REST API the tools call. */
  api: SirenicApi;
  /** The hosted tool list, read at startup to bring the list up to date; none: the snapshot alone. */
  remote?: RemoteServer;
  /** Injected in tests; the shipped snapshot otherwise. */
  snapshot?: () => Snapshot;
  /** Startup and incident lines, for stderr. Never a secret. */
  log?: (line: string) => void;
}

/** The facilitator's reason for an EIP-3009 authorization already used on chain: it may have settled a payment. */
const AUTHORIZATION_ALREADY_USED = "invalid_exact_evm_nonce_already_used";

/**
 * A quote with no rail to pay it: the quote and the free key offer, as the API sent them, and how to pay. The API's own
 * sentence on the free tier leads (it says whether this route is in it); the package never calls a key free for a route
 * the API prices above the free tier.
 */
function paymentRequired(answer: ApiAnswer, quote: PaymentRequired, config: Config): CallToolResult {
  const price = quotePrice(quote);
  const priceText = price !== undefined ? formatUsd(price) : "the quoted amount";
  const { freeTier, pricingNote } = quoteBody(answer);
  const summary = typeof freeTier?.summary === "string" ? freeTier.summary : undefined;
  const signup = typeof freeTier?.signup_url === "string" ? freeTier.signup_url : undefined;
  const key =
    freeTier?.this_route === false
      ? "an API key, which pays this route from prepaid credits"
      : `an API key${summary === undefined && signup ? `: ${signup}` : ""}`;
  const hint =
    `paiement_requis: this tool costs ${priceText} per call. ` +
    (config.rail === "key"
      ? `The API key did not cover this call${config.walletKey !== undefined ? " and the wallet is never used when SIRENIC_API_KEY is set" : ""}.`
      : `${summary ? `${summary} ` : ""}To pay, set SIRENIC_API_KEY (${key}) or SIRENIC_WALLET_KEY (an x402 wallet, USDC on Base) in this MCP server's environment, then restart it.`) +
    (pricingNote ? ` ${pricingNote}` : "");
  const structured = { payment_required: true, hint, quote, ...(freeTier ? { free_tier: freeTier } : {}) };
  return {
    content: [{ type: "text", text: JSON.stringify({ error: "paiement_requis", price_usd: priceText, ...structured }, null, 2) }],
    structuredContent: structured,
    isError: false,
  };
}

function withReceipt(result: CallToolResult, answer: ApiAnswer): CallToolResult {
  const receipt = receiptOf(answer);
  return receipt === undefined ? result : { ...result, _meta: { ...(result._meta ?? {}), "x402/payment-response": receipt } };
}

/** The settlement block of a 402 the API served after a signed payment (`reglement_refuse`, `reglement_indetermine`). */
function settlementOf(answer: ApiAnswer): { outcome: "refuse" | "indetermine"; transaction?: string } | undefined {
  const body = jsonOf(answer);
  if (!body.ok || body.value === null || typeof body.value !== "object") return undefined;
  const { error, settlement } = body.value as { error?: unknown; settlement?: { transaction?: unknown } };
  const outcome = error === "reglement_indetermine" ? "indetermine" : error === "reglement_refuse" ? "refuse" : undefined;
  if (!outcome) return undefined;
  const transaction = typeof settlement?.transaction === "string" ? settlement.transaction : undefined;
  return { outcome, ...(transaction ? { transaction } : {}) };
}

function uncertain(price: bigint, why: string, details: Record<string, unknown> = {}): CallToolResult {
  return packageError(
    "reglement_incertain",
    `${why} The payment may have been settled: it counts against the session cap and nothing was replayed. Check the wallet's USDC balance (and the transaction, when there is one) before retrying.`,
    { price_usd: formatUsd(price), ...details },
  );
}

function cancelled(): CallToolResult {
  return packageError("appel_annule", "The call was cancelled by the client before any signed payment was sent: nothing was paid.");
}

export class SirenicServer {
  readonly server: Server;
  private readonly wallet: Wallet | undefined;

  private constructor(
    private readonly options: SirenicServerOptions,
    private readonly catalogue: Catalogue,
  ) {
    const { config } = options;
    this.wallet = config.rail === "wallet" && config.walletKey ? new Wallet(config.walletKey, config.maxPerCall, config.maxPerSession) : undefined;
    this.server = new Server(
      { name: "sirenic", title: "Sirenic", version: PACKAGE_VERSION },
      { capabilities: { tools: {} }, ...(catalogue.instructions ? { instructions: catalogue.instructions } : {}) },
    );
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.catalogue.tools }));
    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
      this.call(request.params.name, request.params.arguments, extra.signal),
    );
  }

  /**
   * Builds the local server: the catalogue from the snapshot, brought up to date from the hosted tool list when it answers
   * (never a source of calls; without it, the snapshot alone serves and the calls still go to the REST API).
   */
  static async start(options: SirenicServerOptions): Promise<SirenicServer> {
    const log = options.log ?? (() => undefined);
    let catalogue = catalogueFromSnapshot((options.snapshot ?? readSnapshot)());
    for (const e of catalogue.excluded) log(`tool not served: ${e.name} (${e.reason})`);
    if (options.remote) {
      try {
        const refreshed = refreshCatalogue(catalogue, await options.remote.listTools());
        catalogue = refreshed.catalogue;
        for (const note of refreshed.notes) log(note);
      } catch (error) {
        log(`tool list not refreshed (${error instanceof Error ? error.message : String(error)}): serving the snapshot of ${catalogue.snapshotDate}.`);
      } finally {
        await options.remote.close();
      }
    }
    return new SirenicServer(options, catalogue);
  }

  get tools(): Catalogue {
    return this.catalogue;
  }

  get spent(): bigint {
    return this.wallet?.spent ?? 0n;
  }

  async call(name: string, rawArgs: Record<string, unknown> | undefined, signal?: AbortSignal): Promise<CallToolResult> {
    const entry = this.catalogue.byName.get(name);
    if (!entry) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    const read = readArguments(entry.schema, withoutPaymentArguments(rawArgs));
    if (!read.ok) return packageError("argument_invalide", `Invalid arguments for tool ${name}: ${read.reason}. Nothing was sent.`);
    const request = requeteDeLOutil(entry.template, read.value);
    if ("refus" in request) {
      return request.refus === "argument_invalide"
        ? packageError("argument_invalide", `Invalid arguments for tool ${name}: ${englishReason(request.raison)}. Nothing was sent.`)
        : packageError("gabarit_invalide", `The call template of ${name} gives no request for these arguments (${englishReason(request.raison)}): a fault of Sirenic, not of the caller. Nothing was sent.`);
    }
    try {
      return await this.send(name, entry, request.chemin, request.accept, signal);
    } catch (error) {
      if (error instanceof InvariantError) {
        throw new McpError(ErrorCode.InternalError, `Internal error of the package (${error.message}): nothing was sent.`);
      }
      throw error;
    }
  }

  private async send(name: string, entry: ServedTool, chemin: string, accept: string, signal: AbortSignal | undefined): Promise<CallToolResult> {
    const { api, config } = this.options;
    const first = await api.send(chemin, accept, undefined, signal);
    if (first.kind === "cancelled") return cancelled();
    if (first.kind === "unreachable") return packageError("service_injoignable", `The Sirenic API could not be reached (${first.detail}). Nothing was signed.`);
    const quote = quoteOf(first.answer);
    // Data, or an error of the API (503 amont_indisponible, 401 for a refused key, 402 credits_insuffisants...): as served.
    if (!quote) return withReceipt(renderAnswer(first.answer, entry.template.rendu, name), first.answer);
    if (!this.wallet) return paymentRequired(first.answer, quote, config);

    // The price is reserved against the session cap inside decide(), before the first await below: calls sent together
    // never pass the same check. The reservation becomes spending on a result or on an uncertain settlement, and is given
    // back on every other outcome (the finally below covers any path that did not settle it).
    const decision = this.wallet.decide(quote);
    if (!decision.ok) {
      const priceText = decision.price !== undefined ? formatUsd(decision.price) : "unreadable";
      const reserved = this.wallet.reserved;
      const inFlight = reserved > 0n ? ` and ${formatUsd(reserved)} is held by calls in progress` : "";
      const message =
        decision.scope === "call"
          ? `The quote is ${priceText}, above the cap of ${formatUsd(config.maxPerCall)} per call. Nothing was signed. To pay it, raise ${decision.variable} (or ${decision.alias}) in this MCP server's environment and restart it.`
          : `The quote is ${priceText} and ${formatUsd(this.wallet.spent)} of the ${formatUsd(config.maxPerSession)} session cap is already spent${inFlight}. Nothing was signed. To go on, raise ${decision.variable} (or ${decision.alias}) and restart this MCP server.`;
      return packageError("plafond_depasse", message, {
        price_usd: priceText,
        cap_usd: formatUsd(decision.scope === "call" ? config.maxPerCall : config.maxPerSession),
        session_spent_usd: formatUsd(this.wallet.spent),
        ...(reserved > 0n ? { session_reserved_usd: formatUsd(reserved) } : {}),
        variable: decision.variable,
      });
    }

    const { reservation } = decision;
    try {
      if (signal?.aborted) return cancelled();
      let signed: { header: string; amount: bigint };
      try {
        signed = await this.wallet.sign(quote, reservation.amount);
      } catch (error) {
        return packageError("paiement_refuse", `The quote could not be signed by the local wallet (${error instanceof Error ? error.message : String(error)}). Nothing was sent.`);
      }
      if (signal?.aborted) return cancelled();
      const paid = await api.send(chemin, accept, signed.header, signal);
      if (paid.kind !== "answer") {
        reservation.settle();
        return uncertain(
          reservation.amount,
          paid.kind === "cancelled"
            ? "The call was cancelled by the client while the signed payment was being sent."
            : `The connection to the Sirenic API broke after the signed payment was sent (${paid.detail}).`,
        );
      }
      return this.afterPayment(name, entry, paid.answer, reservation);
    } finally {
      reservation.release();
    }
  }

  /** The answer to a signed payment: what it is decides whether the reserved price is spent, given back, or counted as
   *  possibly settled. */
  private afterPayment(name: string, entry: ServedTool, answer: ApiAnswer, reservation: Reservation): CallToolResult {
    const price = reservation.amount;
    if (answer.status >= 200 && answer.status < 300) {
      reservation.settle();
      return withReceipt(renderAnswer(answer, entry.template.rendu, name), answer);
    }
    if (answer.status === 402) {
      // The settlement outcome is read before any quote: a settlement the facilitator could not confirm may have paid.
      const settlement = settlementOf(answer);
      if (settlement?.outcome === "indetermine") {
        reservation.settle();
        return uncertain(price, "The Sirenic API could not confirm the settlement of the signed payment (reglement_indetermine).", {
          statut_http: 402,
          ...(settlement.transaction ? { transaction: settlement.transaction } : {}),
        });
      }
      if (settlement?.outcome === "refuse") {
        return packageError("paiement_refuse", "The Sirenic API refused the settlement of the signed payment (reglement_refuse): nothing was settled. Nothing was replayed.", {
          price_usd: formatUsd(price),
        });
      }
      const again = quoteOf(answer);
      if (again) {
        const reason = typeof (again as { error?: unknown }).error === "string" ? (again as { error: string }).error : undefined;
        if (reason === AUTHORIZATION_ALREADY_USED) {
          reservation.settle();
          return uncertain(price, `The Sirenic API answered that the signed authorization was already used on chain (${reason}).`, { statut_http: 402 });
        }
        return packageError("paiement_refuse", `The Sirenic API rejected the signed payment${reason ? ` (${reason})` : ""}. Nothing was replayed.`, {
          price_usd: formatUsd(price),
        });
      }
      reservation.settle();
      return uncertain(price, "The Sirenic API answered the signed payment with a 402 that is neither a quote nor a settlement outcome.", { statut_http: 402 });
    }
    // An error of the API cancels the payment (nobody pays for a 400, 404 or 503): as served, nothing counted. Whatever
    // else answered (a proxy page, a 502 or 504, JSON without a code) does not say what happened to the payment.
    if (apiErrorCode(answer) !== undefined) return renderAnswer(answer, entry.template.rendu, name);
    reservation.settle();
    return uncertain(price, `The answer to the signed payment is not the Sirenic API's (HTTP ${answer.status}).`, { statut_http: answer.status });
  }
}

/** Builds the local server for `config`. */
export async function startSirenicServer(
  config: Config,
  api: SirenicApi,
  extra: Omit<SirenicServerOptions, "config" | "api"> = {},
): Promise<SirenicServer> {
  return SirenicServer.start({ config, api, ...extra });
}

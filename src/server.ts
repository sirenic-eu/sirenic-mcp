/**
 * The local MCP server (stdio side): it lists the Sirenic catalogue and forwards each call to the Sirenic
 * server. The paywall stays on the server: the package never calls a REST route, never builds a quote, and only
 * signs a quote the server returned, under the caps.
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
import { toLocalTool, withoutPaymentArguments, type Catalogue } from "./catalogue.js";
import type { Config } from "./config.js";
import { packageError } from "./errors.js";
import { formatUsd } from "./money.js";
import { classifyFailure, type RemoteServer, type TransportFailure } from "./remote.js";
import { readSnapshot, type Snapshot } from "./snapshot.js";
import { PACKAGE_VERSION } from "./version.js";
import { isQuote, quotePrice, Wallet } from "./wallet.js";

export interface SirenicServerOptions {
  config: Config;
  remote: RemoteServer;
  /** Injected in tests; the shipped snapshot otherwise. */
  snapshot?: () => Snapshot;
  /** Startup and incident lines, for stderr. Never a secret. */
  log?: (line: string) => void;
}

/** A key the server refused at startup: final for the life of the process (restart with a valid key). */
type KeyState = "cle_invalide" | "compte_inactif" | undefined;

function snapshotCatalogue(snapshot: Snapshot): Catalogue {
  return {
    tools: snapshot.tools.map(toLocalTool),
    source: "snapshot",
    snapshotDate: snapshot.generated_at,
    serverVersion: snapshot.server.version,
    ...(snapshot.instructions ? { instructions: snapshot.instructions } : {}),
  };
}

/** What the client is told when the list comes from the snapshot: why, and what every call will answer. */
function instructionsFor(catalogue: Catalogue, keyState: KeyState): string {
  const parts = [catalogue.instructions ?? ""];
  if (catalogue.source === "snapshot") {
    const date = catalogue.snapshotDate ?? "unknown date";
    parts.push(
      keyState === "cle_invalide"
        ? `Tool list served from the snapshot of ${date}: the Sirenic server refused SIRENIC_API_KEY (401) when this server started, and every call answers cle_invalide until it is restarted with a valid key.`
        : keyState === "compte_inactif"
          ? `Tool list served from the snapshot of ${date}: the Sirenic account of SIRENIC_API_KEY is suspended or closed (403), and every call answers compte_inactif.`
          : `Tool list served from the snapshot of ${date}: the Sirenic server could not be reached when this server started, and calls are refused until it answers.`,
    );
  }
  return parts.filter((p) => p !== "").join(" ");
}

/** A key the server refuses (401, 403) on the key rail: final for the life of the process. */
function refusedKey(config: Config, failure: TransportFailure): KeyState {
  if (config.rail !== "key" || failure.kind !== "http") return undefined;
  return failure.status === 401 ? "cle_invalide" : failure.status === 403 ? "compte_inactif" : undefined;
}

function failureText(failure: TransportFailure): string {
  switch (failure.kind) {
    case "http":
      return `HTTP ${failure.status}`;
    case "timeout":
      return "timeout";
    case "network":
      return `network error (${failure.detail})`;
    case "protocol":
      return `protocol error (${failure.detail})`;
  }
}

/** The quote a tool result carries, when the server answered with one (`structuredContent.quote`). */
function quoteOf(result: CallToolResult): PaymentRequired | undefined {
  const s = result.structuredContent as { payment_required?: unknown; quote?: unknown } | undefined;
  return s?.payment_required === true && isQuote(s.quote) ? s.quote : undefined;
}

/** The free key offer of the quote, as the server sent it (`free_tier`): its own summary, whether it covers this route. */
function freeTier(result: CallToolResult): { summary?: string; thisRoute?: boolean; signup?: string } {
  const offer = (result.structuredContent as { free_tier?: { summary?: unknown; this_route?: unknown; signup_url?: unknown } } | undefined)?.free_tier;
  return {
    ...(typeof offer?.summary === "string" ? { summary: offer.summary } : {}),
    ...(typeof offer?.this_route === "boolean" ? { thisRoute: offer.this_route } : {}),
    ...(typeof offer?.signup_url === "string" ? { signup: offer.signup_url } : {}),
  };
}

/**
 * A quote with no rail to pay it: the quote and the free key offer, as the server sent them, and how to pay. The
 * server's own sentence on the free tier leads (it says whether this route is in it); the package never calls a key
 * free for a route the server prices above the free tier.
 */
function paymentRequired(result: CallToolResult, quote: PaymentRequired, walletIgnored: boolean): CallToolResult {
  const price = quotePrice(quote);
  const priceText = price !== undefined ? formatUsd(price) : "the quoted amount";
  const offer = freeTier(result);
  const key =
    offer.thisRoute === false
      ? "an API key, which pays this route from prepaid credits"
      : `an API key${offer.summary === undefined && offer.signup ? `: ${offer.signup}` : ""}`;
  const hint =
    `paiement_requis: this tool costs ${priceText} per call. ` +
    (walletIgnored
      ? "The API key did not cover this call and the wallet is never used when SIRENIC_API_KEY is set."
      : `${offer.summary ? `${offer.summary} ` : ""}To pay, set SIRENIC_API_KEY (${key}) or SIRENIC_WALLET_KEY (an x402 wallet, USDC on Base) in this MCP server's environment, then restart it.`);
  const s = result.structuredContent as Record<string, unknown>;
  const structured = { payment_required: true, hint, quote, ...(s.free_tier ? { free_tier: s.free_tier } : {}) };
  return {
    content: [{ type: "text", text: JSON.stringify({ error: "paiement_requis", price_usd: priceText, ...structured }, null, 2) }],
    structuredContent: structured,
    isError: false,
  };
}

export class SirenicServer {
  readonly server: Server;
  private catalogue: Catalogue;
  private readonly wallet: Wallet | undefined;
  private keyState: KeyState;

  private constructor(
    private readonly options: SirenicServerOptions,
    catalogue: Catalogue,
    keyState: KeyState,
  ) {
    this.catalogue = catalogue;
    this.keyState = keyState;
    const { config } = options;
    this.wallet = config.rail === "wallet" && config.walletKey ? new Wallet(config.walletKey, config.maxPerCall, config.maxPerSession) : undefined;
    this.server = new Server(
      { name: "sirenic", title: "Sirenic", version: PACKAGE_VERSION },
      { capabilities: { tools: { listChanged: true } }, instructions: instructionsFor(catalogue, keyState) },
    );
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.catalogue.tools }));
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => this.call(request.params.name, request.params.arguments));
  }

  /** Reads the catalogue from the server (the shipped snapshot if it does not answer) and builds the local server. */
  static async start(options: SirenicServerOptions): Promise<SirenicServer> {
    const log = options.log ?? (() => undefined);
    let catalogue: Catalogue;
    let keyState: KeyState;
    try {
      const list = await options.remote.listTools();
      catalogue = {
        tools: list.tools.map(toLocalTool),
        source: "remote",
        ...(list.instructions ? { instructions: list.instructions } : {}),
        ...(list.serverVersion ? { serverVersion: list.serverVersion } : {}),
      };
    } catch (error) {
      await options.remote.reset();
      const failure = classifyFailure(error);
      keyState = refusedKey(options.config, failure);
      if (keyState && failure.kind === "http") {
        log(`SIRENIC_API_KEY refused by the server (${failure.status}): every call will answer ${keyState}; the wallet is never used instead.`);
      } else {
        log(`Sirenic server unreachable (${failureText(failure)}): serving the shipped tool list, calls are refused until it answers.`);
      }
      catalogue = snapshotCatalogue((options.snapshot ?? readSnapshot)());
    }
    return new SirenicServer(options, catalogue, keyState);
  }

  get tools(): Catalogue {
    return this.catalogue;
  }

  get spent(): bigint {
    return this.wallet?.spent ?? 0n;
  }

  private keyError(state: Exclude<KeyState, undefined>): CallToolResult {
    return state === "cle_invalide"
      ? packageError("cle_invalide", "The Sirenic server refused SIRENIC_API_KEY (401). Check the key in your account (https://api.sirenic.eu/compte) and restart this server; the wallet is never used instead.")
      : packageError("compte_inactif", "The Sirenic account of SIRENIC_API_KEY is suspended or closed (403).");
  }

  /** A call that did not reach a tool result. `signed`: a payment had been sent (the server may have settled it). */
  private transportError(failure: TransportFailure, signed: boolean): CallToolResult {
    if (failure.kind === "http" && failure.status === 429) {
      return packageError("trop_de_requetes", "The Sirenic server is rate limiting this address (60 MCP requests a minute). Wait a minute, then retry.", {
        ...(signed ? { payment: "not settled: the request was refused before reaching the tool" } : {}),
      });
    }
    const refused = refusedKey(this.options.config, failure);
    if (refused) {
      this.keyState = refused;
      return this.keyError(refused);
    }
    if (signed) {
      return packageError(
        "reglement_incertain",
        `The connection to the Sirenic server broke after the signed payment was sent (${failureText(failure)}). The server may have settled it: nothing was replayed. Check the wallet's USDC balance before retrying.`,
      );
    }
    return packageError("service_injoignable", `The Sirenic server could not be reached (${failureText(failure)}). Nothing was signed.`);
  }

  /**
   * In snapshot mode, one attempt to reach the server again, which refreshes the list: nothing when it answers, else
   * the error the call returns (the key refused, 401 or 403, is an error of the key, not of the network).
   */
  private async reconnect(): Promise<CallToolResult | undefined> {
    try {
      const list = await this.options.remote.listTools();
      this.catalogue = {
        tools: list.tools.map(toLocalTool),
        source: "remote",
        ...(list.instructions ? { instructions: list.instructions } : {}),
        ...(list.serverVersion ? { serverVersion: list.serverVersion } : {}),
      };
      await this.server.sendToolListChanged().catch(() => undefined);
      return undefined;
    } catch (error) {
      await this.options.remote.reset();
      const refused = refusedKey(this.options.config, classifyFailure(error));
      if (refused) {
        this.keyState = refused;
        return this.keyError(refused);
      }
      return packageError("service_injoignable", "The Sirenic server could not be reached: the tool list comes from the shipped snapshot and calls are refused until the server answers. Nothing was signed.");
    }
  }

  async call(name: string, rawArgs: Record<string, unknown> | undefined): Promise<CallToolResult> {
    if (!this.catalogue.tools.some((t) => t.name === name)) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    if (this.keyState) return this.keyError(this.keyState);
    if (this.catalogue.source === "snapshot") {
      const unreachable = await this.reconnect();
      if (unreachable) return unreachable;
    }
    const args = withoutPaymentArguments(rawArgs);
    const { remote, config } = this.options;

    let first: CallToolResult;
    try {
      first = await remote.callTool(name, args);
    } catch (error) {
      return this.transportError(classifyFailure(error), false);
    }
    const quote = quoteOf(first);
    // Data, a server error (503 amont_indisponible, 401 compte_requis, 402 credits_insuffisants...): as the server sent it.
    if (!quote) return first;
    if (!this.wallet) return paymentRequired(first, quote, config.rail === "key" && config.walletKey !== undefined);

    // The price is reserved against the session cap inside decide(), before the first await below: calls sent together
    // never pass the same check. The reservation becomes spending on a result or on an uncertain settlement, and is
    // given back on every other outcome (the finally below covers any path that did not settle it).
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
      let signed: { header: string; amount: bigint };
      try {
        signed = await this.wallet.sign(quote, reservation.amount);
      } catch (error) {
        return packageError("paiement_refuse", `The quote could not be signed by the local wallet (${error instanceof Error ? error.message : String(error)}). Nothing was sent.`);
      }

      let paid: CallToolResult;
      try {
        paid = await remote.callTool(name, { ...args, x_payment: signed.header });
      } catch (error) {
        const failure = classifyFailure(error);
        // 429: refused before the tool, nothing settled. Anything else after a signed payment: it may have been settled.
        if (!(failure.kind === "http" && failure.status === 429)) reservation.settle();
        return this.transportError(failure, true);
      }
      const again = quoteOf(paid);
      if (again) {
        const reason = typeof (again as { error?: unknown }).error === "string" ? ` (${(again as { error: string }).error})` : "";
        return packageError("paiement_refuse", `The Sirenic server rejected the signed payment${reason}. Nothing was replayed.`, {
          price_usd: formatUsd(signed.amount),
        });
      }
      // A tool error cancels the payment on the server (nobody pays for a 400, 404 or 503): only a result counts.
      if (!paid.isError) reservation.settle();
      return paid;
    } finally {
      reservation.release();
    }
  }
}

/** Builds the local server for `config`: the remote connection, the catalogue, the rails. */
export async function startSirenicServer(
  config: Config,
  remote: RemoteServer,
  extra: Omit<SirenicServerOptions, "config" | "remote"> = {},
): Promise<SirenicServer> {
  return SirenicServer.start({ config, remote, ...extra });
}

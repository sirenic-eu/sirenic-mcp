/**
 * The x402 rail: a local wallet signs the quote the Sirenic server returned, within two caps (per call and per
 * session). The package never builds a quote, never knows a price it would apply: it only signs what the server
 * quoted, and only below the caps. The private key stays in memory; nothing is written anywhere.
 */
import { x402Client } from "@x402/core/client";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { DECIMALS, formatUsd } from "./money.js";
import { CAP_PER_CALL_VARIABLES, CAP_PER_SESSION_VARIABLES } from "./config.js";

const USDC_DECIMALS = DECIMALS;

/**
 * Copied from sirenic-examples, sdk/typescript/src/client.ts (MIT, same authors): drops every payment option
 * above the cap, in atomic units of a 6-decimal stablecoin.
 */
export function pricecapPolicy(maxPriceUsd: number) {
  const maxAtomic = BigInt(Math.round(maxPriceUsd * 10 ** USDC_DECIMALS));
  return (_version: number, requirements: PaymentRequirements[]): PaymentRequirements[] =>
    requirements.filter((r) => {
      const brut =
        (r as { amount?: string }).amount ??
        (r as { maxAmountRequired?: string }).maxAmountRequired ??
        "0";
      try {
        return BigInt(brut) <= maxAtomic;
      } catch {
        return false;
      }
    });
}

/** An x402 v2 quote as the server returns it under `structuredContent.quote`. */
export function isQuote(value: unknown): value is PaymentRequired {
  const q = value as { x402Version?: unknown; accepts?: unknown } | null;
  return q !== null && typeof q === "object" && typeof q.x402Version === "number" && Array.isArray(q.accepts) && q.accepts.length > 0;
}

/** The lowest amount among the quote's options (USDC and EURC are quoted at the same figure). */
export function quotePrice(quote: PaymentRequired): bigint | undefined {
  let lowest: bigint | undefined;
  for (const option of quote.accepts) {
    try {
      const amount = BigInt((option as { amount?: string }).amount ?? "");
      if (amount >= 0n && (lowest === undefined || amount < lowest)) lowest = amount;
    } catch {
      // unreadable option: ignored
    }
  }
  return lowest;
}

/**
 * The quoted price, held against the session cap from the moment the cap is checked until the payment is settled or
 * given up. `settle()` turns it into spending, `release()` gives it back; whichever comes first wins, the other is a
 * no-op.
 */
export interface Reservation {
  readonly amount: bigint;
  settle(): void;
  release(): void;
}

export type CapDecision =
  | { ok: true; price: bigint; reservation: Reservation }
  | { ok: false; price: bigint | undefined; limit: bigint; variable: string; alias: string; scope: "call" | "session" };

export class Wallet {
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private spentAtomic = 0n;
  /** Held by calls between the cap check and the end of their payment (calls run concurrently). */
  private reservedAtomic = 0n;

  constructor(
    privateKey: `0x${string}`,
    private readonly maxPerCall: bigint,
    private readonly maxPerSession: bigint,
  ) {
    this.account = privateKeyToAccount(privateKey);
  }

  get address(): string {
    return this.account.address;
  }

  get spent(): bigint {
    return this.spentAtomic;
  }

  get reserved(): bigint {
    return this.reservedAtomic;
  }

  get sessionCap(): bigint {
    return this.maxPerSession;
  }

  /**
   * Whether the quote fits under the cap per call and under what is left of the session cap, once the spending and the
   * reservations of the calls in flight are counted; if it fits, the price is RESERVED here, synchronously, before any
   * signature: calls sent together (an MCP client may run the tools of one turn at once) cannot all pass the same check.
   */
  decide(quote: PaymentRequired): CapDecision {
    const price = quotePrice(quote);
    const committed = this.spentAtomic + this.reservedAtomic;
    const left = this.maxPerSession > committed ? this.maxPerSession - committed : 0n;
    const limit = this.maxPerCall < left ? this.maxPerCall : left;
    if (price !== undefined && price <= limit) return { ok: true, price, reservation: this.reserve(price) };
    const callBlocks = price === undefined || price > this.maxPerCall;
    const [variable, alias] = callBlocks ? CAP_PER_CALL_VARIABLES : CAP_PER_SESSION_VARIABLES;
    return { ok: false, price, limit, variable, alias, scope: callBlocks ? "call" : "session" };
  }

  private reserve(amount: bigint): Reservation {
    this.reservedAtomic += amount;
    let open = true;
    const close = (spend: boolean) => {
      if (!open) return;
      open = false;
      this.reservedAtomic -= amount;
      if (spend) this.spentAtomic += amount;
    };
    return { amount, settle: () => close(true), release: () => close(false) };
  }

  /**
   * Signs one option of the quote at or under `limit` (EIP-3009 authorization, no gas); the header value for
   * `x_payment`. The caller passes the amount it reserved: nothing above it can be signed.
   */
  async sign(quote: PaymentRequired, limit: bigint): Promise<{ header: string; amount: bigint }> {
    const client = new x402Client();
    registerExactEvmScheme(client, { signer: this.account });
    client.registerPolicy(pricecapPolicy(Number(limit) / 10 ** USDC_DECIMALS));
    // The SDK's own spend control, set to the same limit (its default cap is $1 per payment).
    client.setSpendControls({ maxAmountPerPayment: formatUsd(limit) });
    const payload = await client.createPaymentPayload(quote);
    const amount = BigInt((payload.accepted as { amount?: string }).amount ?? "0");
    if (amount > limit) throw new Error(`signed amount ${formatUsd(amount)} above the limit ${formatUsd(limit)}`);
    return { header: encodePaymentSignatureHeader(payload), amount };
  }

}

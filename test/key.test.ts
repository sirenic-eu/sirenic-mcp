/**
 * The API key rail (letter M3 A, decision C): SIRENIC_API_KEY goes as X-Api-Key to the REST API only (never to /mcp,
 * never in tool arguments) and wins over the wallet. The API's answers on this rail reach the client as served, a refused
 * key (401) or a suspended account (403) included (choice Q7 A of 18/10/2026): the package does not judge the key.
 */
import { generatePrivateKey } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";
import { dataReply, errorReply, quoteReply } from "./helpers/fixtures.js";
import { localServer, resultOf } from "./helpers/local.js";

const API_KEY = "srn_live_test-key-not-real";
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

describe("API key rail", () => {
  it("every call carries X-Api-Key, the key never in the arguments nor the query", async () => {
    const t = await localServer({ SIRENIC_API_KEY: API_KEY }, { onRequest: () => dataReply() });
    close = t.close;
    const r = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(r.isError).toBe(false);
    expect(t.api.requests.length).toBe(1);
    const q = t.api.requests[0]!;
    expect(q.headers["x-api-key"]).toBe(API_KEY);
    expect(q.headers.authorization).toBeUndefined();
    expect(q.headers["payment-signature"]).toBeUndefined();
    expect(q.url).not.toContain(API_KEY);
  });

  it("key and wallet both set: the key pays, the wallet never signs (a quote comes back as paiement_requis)", async () => {
    const t = await localServer({ SIRENIC_API_KEY: API_KEY, SIRENIC_WALLET_KEY: generatePrivateKey() }, { onRequest: () => quoteReply("search_french_companies") });
    close = t.close;
    const r = await t.client.callTool({ name: "search_french_companies", arguments: { q: "danone" } });
    const s = r.structuredContent as { payment_required: boolean; hint: string };
    expect(s.payment_required).toBe(true);
    expect(s.hint).toContain("The API key did not cover this call and the wallet is never used when SIRENIC_API_KEY is set.");
    expect(t.api.requests.length).toBe(1);
    expect(t.api.requests.every((q) => q.headers["payment-signature"] === undefined)).toBe(true);
    expect(t.local.spent).toBe(0n);
  });

  it("key alone and a quote: the hint does not ask to set the key again", async () => {
    const t = await localServer({ SIRENIC_API_KEY: API_KEY }, { onRequest: () => quoteReply("search_french_companies") });
    close = t.close;
    const r = await t.client.callTool({ name: "search_french_companies", arguments: { q: "danone" } });
    const s = r.structuredContent as { hint: string };
    expect(s.hint).toContain("The API key did not cover this call.");
    expect(s.hint).not.toContain("set SIRENIC_API_KEY");
  });

  it("Q7 A: a refused key (401) and a suspended account (403) come back as the API served them, and the next call asks again", async () => {
    const answers = [errorReply(401, { error: "cle_invalide", message: "Invalid API key" }), errorReply(403, { error: "compte_inactif", message: "Account suspended" }), dataReply()];
    const t = await localServer({ SIRENIC_API_KEY: API_KEY, SIRENIC_WALLET_KEY: generatePrivateKey() }, { onRequest: (_q, n) => answers[n - 1]! });
    close = t.close;
    const call = () => t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(resultOf(await call())).toEqual({ statut_http: 401, error: "cle_invalide", message: "Invalid API key" });
    expect(resultOf(await call())).toEqual({ statut_http: 403, error: "compte_inactif", message: "Account suspended" });
    expect((await call()).isError).toBe(false);
    expect(t.api.requests.length).toBe(3);
    expect(t.api.requests.every((q) => q.headers["x-api-key"] === API_KEY && q.headers["payment-signature"] === undefined)).toBe(true);
  });

  it("the API's own errors on this rail reach the client unchanged: 402 credits_insuffisants (no quote), 401 compte_requis", async () => {
    const answers = [errorReply(402, { error: "credits_insuffisants", message: "Insufficient balance" }), errorReply(401, { error: "compte_requis", message: "Deeds require a verified account" })];
    const t = await localServer({ SIRENIC_API_KEY: API_KEY }, { onRequest: (_q, n) => answers[n - 1]! });
    close = t.close;
    const r1 = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(r1.structuredContent).toEqual({ payment_required: false, resultat: { statut_http: 402, error: "credits_insuffisants", message: "Insufficient balance" } });
    expect(r1.isError).toBe(true);
    const r2 = await t.client.callTool({ name: "download_french_company_document", arguments: { type: "actes", document_id: "0123456789abcdef01234567" } });
    expect(resultOf(r2)).toEqual({ statut_http: 401, error: "compte_requis", message: "Deeds require a verified account" });
    expect(r2.isError).toBe(true);
  });
});

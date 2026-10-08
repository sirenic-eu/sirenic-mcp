/**
 * The API key rail (letter M3 A): SIRENIC_API_KEY goes as a Bearer token to /mcp/connecteur, never in tool
 * arguments, and wins over the wallet. A refused key never falls back to x402.
 */
import { generatePrivateKey } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";
import { QUOTES, REMOTE, dataResult, serverError } from "./helpers/fixtures.js";
import { localServer } from "./helpers/local.js";

const API_KEY = "srn_live_test-key-not-real";
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

function errorOf(r: unknown): Record<string, string> {
  return (r as { structuredContent: { resultat: Record<string, string> } }).structuredContent.resultat;
}

describe("API key rail", () => {
  it("every request goes to /mcp/connecteur with Authorization: Bearer, the key never in the arguments", async () => {
    const t = await localServer({ SIRENIC_API_KEY: API_KEY }, { tools: REMOTE.tools, onCall: () => ({ result: dataResult() }) });
    close = t.close;
    const r = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(r.isError).toBe(false);
    expect(t.remote.requests.length).toBeGreaterThan(0);
    for (const q of t.remote.requests) {
      expect(q.url).toBe("https://api.sirenic.eu/mcp/connecteur");
      expect(q.headers.authorization).toBe(`Bearer ${API_KEY}`);
    }
    expect(t.remote.calls()[0]?.body?.params?.arguments).toEqual({ siren: "552032534" });
  });

  it("key and wallet both set: the key pays, the wallet never signs (a quote comes back as paiement_requis)", async () => {
    const t = await localServer(
      { SIRENIC_API_KEY: API_KEY, SIRENIC_WALLET_KEY: generatePrivateKey() },
      { tools: REMOTE.tools, onCall: () => ({ result: QUOTES.search_french_companies }) },
    );
    close = t.close;
    const r = await t.client.callTool({ name: "search_french_companies", arguments: { q: "danone" } });
    expect((r.structuredContent as { payment_required: boolean }).payment_required).toBe(true);
    expect(t.remote.calls().every((c) => !c.body?.params?.arguments?.x_payment)).toBe(true);
    expect(t.local.spent).toBe(0n);
  });

  it("key refused at startup (401): snapshot list, every call answers cle_invalide, never the anonymous endpoint nor the wallet", async () => {
    const t = await localServer(
      { SIRENIC_API_KEY: API_KEY, SIRENIC_WALLET_KEY: generatePrivateKey() },
      { tools: REMOTE.tools, refuseWith: () => 401, onCall: () => ({ result: dataResult() }) },
    );
    close = t.close;
    expect(t.logs.join("\n")).toContain("SIRENIC_API_KEY refused by the server (401)");
    const r = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(errorOf(r).error).toBe("cle_invalide");
    expect(t.remote.requests.every((q) => q.url.endsWith("/mcp/connecteur"))).toBe(true);
    expect(t.remote.calls()).toEqual([]);
  });

  it("key refused at startup: the instructions say the key was refused, not that the server could not be reached", async () => {
    const t = await localServer({ SIRENIC_API_KEY: API_KEY }, { tools: REMOTE.tools, refuseWith: () => 401 });
    close = t.close;
    const instructions = t.client.getInstructions() ?? "";
    expect(instructions).toContain("refused SIRENIC_API_KEY (401)");
    expect(instructions).not.toContain("could not be reached");
  });

  it("server unreachable at startup, then the key is refused (401): cle_invalide, not service_injoignable", async () => {
    let up = false;
    const t = await localServer(
      { SIRENIC_API_KEY: API_KEY },
      {
        tools: REMOTE.tools,
        refuseWith: () => {
          if (!up) throw new TypeError("fetch failed (ECONNREFUSED)");
          return 401;
        },
      },
    );
    close = t.close;
    expect(t.logs.join("\n")).toContain("Sirenic server unreachable");
    up = true;
    const first = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(errorOf(first).error).toBe("cle_invalide");
    const before = t.remote.requests.length;
    const second = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(errorOf(second).error).toBe("cle_invalide");
    expect(t.remote.requests.length).toBe(before);
    expect(t.remote.calls()).toEqual([]);
  });

  it("suspended account (403): compte_inactif", async () => {
    const t = await localServer({ SIRENIC_API_KEY: API_KEY }, { tools: REMOTE.tools, refuseWith: () => 403 });
    close = t.close;
    const r = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(errorOf(r).error).toBe("compte_inactif");
  });

  it("the server's own errors reach the client unchanged: 402 credits_insuffisants (no quote), 401 compte_requis", async () => {
    const credits = serverError(402, { error: "credits_insuffisants", message: "Insufficient balance" });
    const account = serverError(401, { error: "compte_requis", message: "Deeds require a verified account" });
    let n = 0;
    const t = await localServer({ SIRENIC_API_KEY: API_KEY }, { tools: REMOTE.tools, onCall: () => ({ result: n++ === 0 ? credits : account }) });
    close = t.close;
    const r1 = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(r1.structuredContent).toEqual(credits.structuredContent);
    const r2 = await t.client.callTool({ name: "download_french_company_document", arguments: { type: "actes", document_id: "0123456789abcdef01234567" } });
    expect(r2.structuredContent).toEqual(account.structuredContent);
    expect(r2.isError).toBe(true);
  });
});

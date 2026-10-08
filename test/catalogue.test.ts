/**
 * The catalogue the local server exposes is the server's tools/list, tool for tool, minus the two payment
 * parameters (letter M2 A), with each tool's _meta (routes and prices, letter M1 A). The shipped snapshot is
 * served when the server does not answer at startup, and every call is then refused without signing (M7 A).
 */
import { generatePrivateKey } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { PAYMENT_ARGUMENTS } from "../src/catalogue.js";
import { REMOTE, SNAPSHOT, dataResult } from "./helpers/fixtures.js";
import { localServer } from "./helpers/local.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

/** The remote tool as the local server should serve it: same fields, payment parameters removed. */
function expected(tool: Tool): Tool {
  const properties = { ...(tool.inputSchema.properties ?? {}) };
  for (const p of PAYMENT_ARGUMENTS) delete properties[p];
  const required = (tool.inputSchema.required ?? []).filter((r) => !(PAYMENT_ARGUMENTS as readonly string[]).includes(r));
  const { required: _r, ...schema } = tool.inputSchema;
  return { ...tool, inputSchema: { ...schema, properties, ...(required.length ? { required } : {}) } };
}

describe("C1: the local catalogue reflects the server's tools/list", () => {
  it("recorded server (2026-10-08, 1.1.0): 112 tools, same names, same descriptions and schemas, no payment parameter", async () => {
    const t = await localServer({}, { tools: REMOTE.tools, instructions: REMOTE.initialize.instructions });
    close = t.close;
    const { tools } = await t.client.listTools();
    expect(REMOTE.tools.length).toBe(112);
    expect(tools.map((x) => x.name)).toEqual(REMOTE.tools.map((x) => x.name));
    expect(tools).toEqual(REMOTE.tools.map(expected));
    // the remote did declare them, on every paid tool
    expect(REMOTE.tools.filter((x) => "x_payment" in (x.inputSchema.properties ?? {})).length).toBe(108);
    for (const tool of tools) {
      for (const p of PAYMENT_ARGUMENTS) expect(Object.keys(tool.inputSchema.properties ?? {}), tool.name).not.toContain(p);
    }
    expect(t.local.tools.source).toBe("remote");
    expect(t.client.getInstructions()).toBe(REMOTE.initialize.instructions);
  });

  it("server 1.2.0 (the snapshot's server): each tool keeps its _meta, routes and prices read from the server's grid", async () => {
    const t = await localServer({}, { tools: SNAPSHOT.tools, serverVersion: "1.2.0" });
    close = t.close;
    const { tools } = await t.client.listTools();
    expect(tools.length).toBe(SNAPSHOT.tools.length);
    expect(tools).toEqual(SNAPSHOT.tools.map(expected));
    const paid = tools.filter((x) => Object.keys((x._meta?.["eu.sirenic/prix"] as object | undefined) ?? {}).length > 0);
    expect(paid.length).toBe(108);
    expect(tools.find((x) => x.name === "search_french_companies")?._meta).toEqual({
      "eu.sirenic/routes": ["GET /v1/recherche"],
      "eu.sirenic/prix": { "GET /v1/recherche": { prix: "$0.002", par: "appel", devis_max: "$0.002" } },
    });
  });

  it("the model cannot pass a payment parameter: x_payment and api_key are dropped before the call", async () => {
    const t = await localServer({}, { tools: REMOTE.tools, onCall: () => ({ result: dataResult() }) });
    close = t.close;
    await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534", x_payment: "forged", api_key: "srn_live_forged" } });
    expect(t.remote.calls()[0]?.body?.params?.arguments).toEqual({ siren: "552032534" });
  });
});

describe("M7: the server does not answer at startup", () => {
  it("the shipped snapshot is served (112 tools, its date in instructions); a call is refused with service_injoignable, nothing signed", async () => {
    const t = await localServer(
      { SIRENIC_WALLET_KEY: generatePrivateKey() },
      { tools: [], endpoints: [] }, // every address refused: the server is unreachable
    );
    close = t.close;
    const { tools } = await t.client.listTools();
    expect(tools.length).toBe(SNAPSHOT.tools.length);
    expect(t.local.tools.source).toBe("snapshot");
    expect(t.client.getInstructions()).toContain(`snapshot of ${SNAPSHOT.generated_at}`);
    expect(t.logs.join("\n")).toContain("serving the shipped tool list");
    const r = await t.client.callTool({ name: "search_french_companies", arguments: { q: "danone" } });
    expect(r.isError).toBe(true);
    expect((r.structuredContent as { resultat: { error: string } }).resultat.error).toBe("service_injoignable");
    expect(t.local.spent).toBe(0n);
    expect(t.remote.calls()).toEqual([]);
  });

  it("the server answers again: the list is read again (tools/list_changed) and the call goes through", async () => {
    let up = false;
    const tools = REMOTE.tools;
    const t = await localServer(
      {},
      { tools, refuseWith: () => (up ? undefined : 503), onCall: () => ({ result: dataResult() }) },
    );
    close = t.close;
    expect(t.local.tools.source).toBe("snapshot");
    up = true;
    const r = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(r.isError).toBe(false);
    expect(t.local.tools.source).toBe("remote");
  });

  it("the shipped snapshot is a dated tools/list of 112 tools, each with its routes and prices", () => {
    expect(SNAPSHOT.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(SNAPSHOT.server.version).toBe("1.2.0");
    expect(SNAPSHOT.tools.length).toBe(112);
    expect(SNAPSHOT.tools.every((x) => x._meta && Array.isArray(x._meta["eu.sirenic/routes"]))).toBe(true);
  });
});

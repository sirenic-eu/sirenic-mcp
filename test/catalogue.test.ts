/**
 * The catalogue is the snapshot shipped in the repository (decision C of 15/10/2026): every tool the package serves is
 * defined there, with its call template, and served without the server; the payment parameters are removed (letter M2 A).
 * A tool that cannot be called the way the hosted server calls it is excluded and named at startup. The hosted tool list,
 * when it answers at startup, only brings the list up to date (choice Q1 A of 18/10/2026): never a source of calls.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { catalogueFromSnapshot, PAYMENT_ARGUMENTS, refreshCatalogue, toLocalTool } from "../src/catalogue.js";
import type { Snapshot } from "../src/snapshot.js";
import { REMOTE, SNAPSHOT, dataReply } from "./helpers/fixtures.js";
import { localServer } from "./helpers/local.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

const clone = <T>(v: T): T => structuredClone(v);
const snapshotWith = (tools: Tool[]): Snapshot => ({ ...SNAPSHOT, tools });
const byName = (name: string): Tool => clone(SNAPSHOT.tools.find((t) => t.name === name)!);

describe("C: the snapshot is the source of the tools served", () => {
  it("the shipped snapshot: every tool carries its call template, none is excluded, the payment parameters are removed", () => {
    const c = catalogueFromSnapshot(SNAPSHOT);
    expect(SNAPSHOT.tools.length).toBeGreaterThanOrEqual(116);
    expect(SNAPSHOT.tools.every((t) => t._meta?.["eu.sirenic/appel"] !== undefined)).toBe(true);
    expect(c.excluded).toEqual([]);
    expect(c.tools.length).toBe(SNAPSHOT.tools.length);
    expect(c.tools).toEqual(SNAPSHOT.tools.map(toLocalTool));
    for (const tool of c.tools) {
      for (const p of PAYMENT_ARGUMENTS) expect(Object.keys(tool.inputSchema.properties ?? {}), tool.name).not.toContain(p);
      expect(tool.inputSchema.required ?? [], tool.name).not.toContain("x_payment");
    }
  });

  it("the shipped snapshot is a dated tools/list of the server, each tool with its routes, prices and call template", () => {
    expect(SNAPSHOT.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(SNAPSHOT.source).toBe("https://api.sirenic.eu/mcp");
    expect(SNAPSHOT.server.version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const t of SNAPSHOT.tools) {
      expect(Array.isArray(t._meta?.["eu.sirenic/routes"]), t.name).toBe(true);
      expect(t._meta?.["eu.sirenic/prix"], t.name).toBeTypeOf("object");
    }
  });

  it("listed without any server: no request at startup, the list and the instructions come from the snapshot", async () => {
    const t = await localServer({}, {});
    close = t.close;
    const { tools } = await t.client.listTools();
    expect(tools.length).toBe(SNAPSHOT.tools.length);
    expect(tools.map((x) => x.name)).toEqual(SNAPSHOT.tools.map((x) => x.name));
    expect(t.client.getInstructions()).toBe(SNAPSHOT.instructions);
    expect(t.api.requests).toEqual([]);
    expect(t.local.tools.refreshed).toBe(false);
  });

  it("the model cannot pass a payment parameter: x_payment and api_key are dropped before the call", async () => {
    const t = await localServer({}, { onRequest: () => dataReply() });
    close = t.close;
    await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534", x_payment: "forged", api_key: "srn_live_forged" } });
    expect(t.api.requests.length).toBe(1);
    expect(t.api.requests[0]!.path).toBe("/v1/entreprise/552032534");
    expect(t.api.requests[0]!.headers["payment-signature"]).toBeUndefined();
    expect(t.api.requests[0]!.headers["x-api-key"]).toBeUndefined();
  });
});

describe("m2 and r6: a tool that cannot be called the way the hosted server calls it is excluded and named", () => {
  it("no template, a template out of the closed form, an unknown schema keyword, a path argument not required, a property the template does not place, a query parameter outside the schema", async () => {
    const noTemplate = byName("get_french_company_profile");
    delete (noTemplate._meta as Record<string, unknown>)["eu.sirenic/appel"];
    const badTemplate = byName("search_french_companies");
    (badTemplate._meta as Record<string, { methode: string }>)["eu.sirenic/appel"]!.methode = "POST";
    const unknownKeyword = byName("get_french_company_default_risk");
    (unknownKeyword.inputSchema.properties as Record<string, Record<string, unknown>>).siren!.oneOf = [{ type: "string" }];
    const notRequired = byName("list_french_company_establishments");
    notRequired.inputSchema.required = (notRequired.inputSchema.required ?? []).filter((r) => r !== "siren");
    const unplaced = byName("get_french_company_briefing");
    (unplaced.inputSchema.properties as Record<string, unknown>).extra = { type: "string" };
    const outsideSchema = byName("get_french_company_intelligence");
    (outsideSchema._meta as Record<string, { requete: Record<string, string> }>)["eu.sirenic/appel"]!.requete = {
      ...((outsideSchema._meta as Record<string, { requete?: Record<string, string> }>)["eu.sirenic/appel"]!.requete ?? {}),
      fantome: "texte",
    };
    const broken = [noTemplate, badTemplate, unknownKeyword, notRequired, unplaced, outsideSchema];
    const names = new Set(broken.map((b) => b.name));
    const t = await localServer({}, {}, { snapshot: snapshotWith(SNAPSHOT.tools.map((x) => broken.find((b) => b.name === x.name) ?? x)) });
    close = t.close;
    const { tools } = await t.client.listTools();
    expect(tools.length).toBe(SNAPSHOT.tools.length - broken.length);
    expect(tools.some((x) => names.has(x.name))).toBe(false);
    const reasons = Object.fromEntries(t.local.tools.excluded.map((e) => [e.name, e.reason]));
    expect(reasons).toEqual({
      get_french_company_profile: "no call template (_meta eu.sirenic/appel)",
      search_french_companies: "call template: unknown method in the call template: POST",
      get_french_company_default_risk: "inputSchema.siren: unknown keyword oneOf",
      list_french_company_establishments: "path argument siren is not required by the input schema",
      get_french_company_briefing: "property extra is not placed by the call template",
      get_french_company_intelligence: "query parameter fantome is not a property of the input schema",
    });
    for (const name of names) expect(t.logs.some((l) => l.startsWith(`tool not served: ${name} (`)), name).toBe(true);
    // an excluded tool is unknown to the client
    await expect(t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } })).rejects.toThrow(/Unknown tool/);
    expect(t.api.requests).toEqual([]);
  });
});

describe("Q1 A and m3: the hosted list brings the list up to date, never the calls", () => {
  it("withdrawn, added, changed template, changed schema, changed descriptions: each named, only what is unchanged is served", () => {
    const base = catalogueFromSnapshot(SNAPSHOT);
    const remote = SNAPSHOT.tools.filter((t) => t.name !== "suggest_company_names").map(clone);
    const find = (name: string) => remote.find((t) => t.name === name)!;
    find("search_french_companies").description = "A new description";
    find("search_french_companies").title = "A new title";
    (find("get_french_company_profile")._meta as Record<string, { chemin: string }>)["eu.sirenic/appel"]!.chemin = "/v1/fiche/{siren}";
    (find("get_french_company_default_risk").inputSchema.properties as Record<string, Record<string, unknown>>).siren!.maxLength = 20;
    (find("get_french_company_intelligence").inputSchema.properties as Record<string, Record<string, unknown>>).vue!.description = "Another text";
    remote.push({ ...clone(find("get_french_company_briefing")), name: "brand_new_tool" });
    const { catalogue, notes } = refreshCatalogue(base, { tools: remote, serverVersion: "9.9.9" });
    const served = new Map(catalogue.tools.map((t) => [t.name, t]));
    expect(served.has("suggest_company_names")).toBe(false);
    expect(served.has("get_french_company_profile")).toBe(false);
    expect(served.has("get_french_company_default_risk")).toBe(false);
    expect(served.has("brand_new_tool")).toBe(false);
    expect(served.get("search_french_companies")?.description).toBe("A new description");
    expect(served.get("search_french_companies")?.title).toBe("A new title");
    // a parameter description is not a change of how the call is made: still served, with the snapshot's schema
    expect(served.has("get_french_company_intelligence")).toBe(true);
    expect(catalogue.byName.get("get_french_company_intelligence")?.schema).toEqual(base.byName.get("get_french_company_intelligence")?.schema);
    // the call template of a served tool is always the snapshot's
    expect(catalogue.byName.get("search_french_companies")?.template).toEqual(base.byName.get("search_french_companies")?.template);
    expect(catalogue.tools.length).toBe(base.tools.length - 3);
    expect(notes).toEqual([
      "withdrawn by the Sirenic server, not served: suggest_company_names",
      "changed on the Sirenic server since the snapshot (call template or input schema), not served until this package is updated: get_french_company_profile, get_french_company_default_risk",
      "added on the Sirenic server, served by a later version of this package: brand_new_tool",
    ]);
  });

  it("r2: the order of the query parameters and of the schema's properties is part of the template: a reordering is a change", () => {
    const base = catalogueFromSnapshot(SNAPSHOT);
    const withQuery = SNAPSHOT.tools.find((t) => Object.keys((t._meta?.["eu.sirenic/appel"] as { requete?: object }).requete ?? {}).length >= 2)!;
    const reordered = SNAPSHOT.tools.map(clone);
    const target = reordered.find((t) => t.name === withQuery.name)!;
    const appel = (target._meta as Record<string, { requete: Record<string, string> }>)["eu.sirenic/appel"]!;
    appel.requete = Object.fromEntries(Object.entries(appel.requete).reverse());
    expect(refreshCatalogue(base, { tools: reordered }).catalogue.byName.has(withQuery.name)).toBe(false);
    // keys of a schema node in another order (as JSON serializers may write them) are not a change
    const keysMoved = SNAPSHOT.tools.map((t) => (t.name === withQuery.name ? { ...clone(t), inputSchema: Object.fromEntries(Object.entries(clone(t).inputSchema).reverse()) as Tool["inputSchema"] } : clone(t)));
    expect(refreshCatalogue(base, { tools: keysMoved }).catalogue.byName.has(withQuery.name)).toBe(true);
  });

  it("a server older than this package (no call templates): tolerated, its descriptions refresh what both serve", () => {
    const base = catalogueFromSnapshot(SNAPSHOT);
    const { catalogue } = refreshCatalogue(base, { tools: REMOTE.tools });
    const old = new Set(REMOTE.tools.map((t) => t.name));
    expect(catalogue.tools.map((t) => t.name)).toEqual(base.tools.map((t) => t.name).filter((n) => old.has(n)));
    expect(catalogue.tools.length).toBeGreaterThan(100);
    for (const t of catalogue.tools) expect(catalogue.byName.get(t.name)?.template).toEqual(base.byName.get(t.name)?.template);
  });

  it("the CLI path: the hosted list read at startup refreshes the catalogue, anonymously, then is closed", async () => {
    const remote = SNAPSHOT.tools.filter((t) => t.name !== "suggest_company_names");
    const t = await localServer({ SIRENIC_API_KEY: "srn_live_test-key-not-real" }, { mcp: { tools: remote, serverVersion: SNAPSHOT.server.version, instructions: "Hosted instructions." } }, { refresh: true });
    close = t.close;
    const { tools } = await t.client.listTools();
    expect(tools.length).toBe(SNAPSHOT.tools.length - 1);
    expect(t.local.tools.refreshed).toBe(true);
    expect(t.client.getInstructions()).toBe("Hosted instructions.");
    expect(t.logs).toContain("withdrawn by the Sirenic server, not served: suggest_company_names");
    // the key never travels to /mcp
    const mcp = t.api.mcp!.requests;
    expect(mcp.length).toBeGreaterThan(0);
    for (const q of mcp) {
      expect(q.url).toBe("https://api.sirenic.eu/mcp");
      expect(q.headers.authorization).toBeUndefined();
      expect(q.headers["x-api-key"]).toBeUndefined();
      expect(q.headers["user-agent"]).toMatch(/^sirenic-mcp-npm\//);
    }
    expect(mcp.some((q) => q.body?.method === "tools/call")).toBe(false);
  });

  it("the hosted list does not answer at startup: the snapshot serves, the calls still go to the API", async () => {
    const t = await localServer({}, { onRequest: () => dataReply() }, { refresh: true });
    close = t.close;
    expect(t.local.tools.refreshed).toBe(false);
    expect(t.logs.join("\n")).toContain(`tool list not refreshed`);
    expect(t.logs.join("\n")).toContain(`serving the snapshot of ${SNAPSHOT.generated_at}`);
    const r = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(r.isError).toBe(false);
    expect(t.api.requests.map((q) => q.path)).toEqual(["/v1/entreprise/552032534"]);
  });
});

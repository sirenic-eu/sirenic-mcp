/**
 * The daily drift guard (case of decision C, choice Q3 A of 18/10/2026): the snapshot compared with the server's
 * tools/list, any difference a client would see counted, key order counted only where it carries meaning (r2), a new
 * server version alone not counted; the report says what differs and carries a fingerprint of the differences only.
 */
import { describe, expect, it } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { compareSnapshot, driftReport, hasDrift, type RemoteRead } from "../scripts/derive-lib.js";
import { SNAPSHOT } from "./helpers/fixtures.js";

const read = (tools: Tool[], extra: Partial<RemoteRead> = {}): RemoteRead => ({
  tools,
  ...(SNAPSHOT.instructions ? { instructions: SNAPSHOT.instructions } : {}),
  serverVersion: SNAPSHOT.server.version,
  readAt: "2026-11-20T06:17:00.000Z",
  source: "https://api.sirenic.eu/mcp",
  ...extra,
});
const copy = (): Tool[] => structuredClone(SNAPSHOT.tools);

describe("drift guard", () => {
  it("the same list, keys of schema nodes in another order, a new server version: no drift", () => {
    const tools = copy().map((t) => ({ ...t, inputSchema: Object.fromEntries(Object.entries(t.inputSchema).reverse()) as Tool["inputSchema"] }));
    expect(hasDrift(compareSnapshot(SNAPSHOT, read(tools, { serverVersion: "9.9.9" })))).toBe(false);
  });

  it("a tool added, a tool withdrawn, a description, a price, a call template, the order of the query, the instructions: each one is a drift", () => {
    const tools = copy();
    const removed = tools.splice(tools.findIndex((t) => t.name === "suggest_company_names"), 1)[0]!;
    tools.push({ ...structuredClone(tools[0]!), name: "brand_new_tool" });
    const byName = (n: string) => tools.find((t) => t.name === n)!;
    byName("search_french_companies").description = "Changed";
    (byName("get_french_company_profile")._meta as Record<string, Record<string, unknown>>)["eu.sirenic/prix"] = { "GET /v1/entreprise/:siren": { prix: "$0.006" } };
    const withQuery = tools.find((t) => Object.keys(((t._meta ?? {})["eu.sirenic/appel"] as { requete?: object }).requete ?? {}).length >= 2)!;
    const appel = (withQuery._meta as Record<string, { requete: Record<string, string> }>)["eu.sirenic/appel"]!;
    appel.requete = Object.fromEntries(Object.entries(appel.requete).reverse());
    const drift = compareSnapshot(SNAPSHOT, read(tools, { instructions: "Other instructions." }));
    expect(hasDrift(drift)).toBe(true);
    expect(drift.added).toEqual(["brand_new_tool"]);
    expect(drift.removed).toEqual([removed.name]);
    expect(drift.changed).toEqual(
      expect.arrayContaining([
        { name: "search_french_companies", fields: ["description"] },
        { name: "get_french_company_profile", fields: ["_meta eu.sirenic/prix"] },
        { name: withQuery.name, fields: ["_meta eu.sirenic/appel"] },
      ]),
    );
    expect(drift.changed.length).toBe(3);
    expect(drift.instructionsChanged).toBe(true);
    const report = driftReport(SNAPSHOT, read(tools), drift);
    expect(report.split("\n")[0]).toMatch(/^<!-- drift fingerprint: [0-9a-f]{16} -->$/);
    expect(report).toContain("`brand_new_tool`");
    expect(report).toContain("`search_french_companies`: description");
    expect(report).not.toContain("—");
  });

  it("the server's instructions alone changed: a drift", () => {
    const drift = compareSnapshot(SNAPSHOT, read(copy(), { instructions: "Other instructions." }));
    expect(drift.changed).toEqual([]);
    expect(hasDrift(drift)).toBe(true);
  });

  it("the fingerprint depends on the differences, not on the date of the read", () => {
    const tools = copy();
    tools[0]!.description = "Changed";
    const drift = compareSnapshot(SNAPSHOT, read(tools));
    const a = driftReport(SNAPSHOT, read(tools), drift).split("\n")[0];
    const b = driftReport(SNAPSHOT, read(tools, { readAt: "2026-12-01T06:17:00.000Z" }), drift).split("\n")[0];
    expect(a).toBe(b);
    tools[1]!.description = "Changed too";
    const c = driftReport(SNAPSHOT, read(tools), compareSnapshot(SNAPSHOT, read(tools))).split("\n")[0];
    expect(c).not.toBe(a);
  });
});

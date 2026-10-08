/** The README: its tools table is the one `npm run tableau` derives from the shipped snapshot; no long dash. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { routePrices } from "../src/catalogue.js";
import { ERROR_CODES } from "../src/errors.js";
import { priceLabel, replaceToolsTable } from "../scripts/tableau-lib.js";
import { QUOTES, SNAPSHOT } from "./helpers/fixtures.js";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("README", () => {
  it("the tools table is generated from the snapshot (else: npm run tableau)", () => {
    expect(README).toBe(replaceToolsTable(README, SNAPSHOT));
    expect(README).toContain("112 tools (108 paid, 4 free) covering France and 19 other European countries");
  });

  it("prices come from each tool's _meta: one figure, per entity, a range, or free", () => {
    const byName = new Map(SNAPSHOT.tools.map((t) => [t.name, t]));
    expect(priceLabel(byName.get("search_french_companies")!)).toBe("$0.002");
    expect(priceLabel(byName.get("compare_french_companies")!)).toBe("$0.12 per entity");
    expect(priceLabel(byName.get("query_french_companies")!)).toBe("$0.002 to $0.02");
    expect(priceLabel(byName.get("suggest_company_names")!)).toBe("free");
    expect(priceLabel({ ...byName.get("search_french_companies")!, _meta: undefined })).toBe("in the quote");
  });

  it("a price that depends on a parameter is never shown as one figure: from the base, up to the maximum the server states", () => {
    const byName = new Map(SNAPSHOT.tools.map((t) => [t.name, t]));
    expect(priceLabel(byName.get("create_surveillance_watch")!)).toBe("from $0.05 (30 days) up to $0.50 (365 days) per entity");
    expect(priceLabel(byName.get("renew_surveillance_watch")!)).toBe("from $0.05 (30 days) up to $0.50 (365 days) per entity");
    expect(priceLabel(byName.get("get_french_company_file")!)).toBe("from $0.005 up to $0.35 (blocks chosen per call)");
    expect(README).toContain("| `create_surveillance_watch` | Create a company watch | from $0.05 (30 days) up to $0.50 (365 days) per entity |");
    expect(README).toContain("| `get_french_company_file` | French company file (choose blocks) | from $0.005 up to $0.35 (blocks chosen per call) |");
    // every route whose _meta states a maximum is shown with it
    const single = SNAPSHOT.tools.filter((t) => {
      const routes = Object.values(routePrices(t) ?? {});
      return routes.some((r) => r.prix_max !== undefined) && !priceLabel(t).includes("up to");
    });
    expect(single.map((t) => t.name)).toEqual([]);
  });

  it("the closed list of errors in the README is the package's own (ERROR_CODES), and paiement_requis is said apart", () => {
    const sentence = /Errors the package returns itself \(a closed list[^)]*\):([\s\S]*?)Errors of the Sirenic server/.exec(README)?.[1] ?? "";
    expect(sentence).not.toBe("");
    expect([...sentence.matchAll(/`([a-z_]+)`/g)].map((m) => m[1])).toEqual([...ERROR_CODES]);
    expect(README).toContain("it answers `payment_required: true` in `structuredContent`, with the\nserver's `quote`");
  });

  it("the free key quota in the README is the server's, read in the recorded quote (free_tier)", () => {
    for (const quote of [QUOTES.search_french_companies, QUOTES.get_french_company_default_risk]) {
      const offer = (quote.structuredContent as { free_tier: { monthly_calls: number; max_price_per_call: string } }).free_tier;
      expect(README).toContain(`A free key gives ${offer.monthly_calls} calls a month on routes at ${offer.max_price_per_call} or less;`);
    }
    // the only figure of the sentence: no other quota written by hand
    expect([...README.matchAll(/(\d+) calls a month/g)].map((m) => m[1])).toEqual(["150"]);
  });

  it("no long dash, no secret-looking value, install in one line", () => {
    for (const file of ["README.md", "CONTRIBUTING.md"]) {
      expect(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), file).not.toMatch(/[\u2014]/);
    }
    expect(README).not.toMatch(/srn_live_[A-Za-z0-9]{8,}/);
    expect(README).not.toMatch(/0x[0-9a-fA-F]{64}/);
    expect(README).toContain("npx -y @sirenic/mcp");
  });
});

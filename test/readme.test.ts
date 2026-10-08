/** The README: its tools table is the one `npm run tableau` derives from the shipped snapshot; no long dash. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { routePrices } from "../src/catalogue.js";
import { priceLabel, replaceToolsTable } from "../scripts/tableau-lib.js";
import { SNAPSHOT } from "./helpers/fixtures.js";

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

  it("no long dash, no secret-looking value, install in one line", () => {
    for (const file of ["README.md", "CONTRIBUTING.md"]) {
      expect(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), file).not.toMatch(/[\u2014]/);
    }
    expect(README).not.toMatch(/srn_live_[A-Za-z0-9]{8,}/);
    expect(README).not.toMatch(/0x[0-9a-fA-F]{64}/);
    expect(README).toContain("npx -y @sirenic/mcp");
  });
});

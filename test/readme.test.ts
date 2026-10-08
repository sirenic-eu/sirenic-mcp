/** The README: its tools table is the one `npm run tableau` derives from the shipped snapshot; no long dash. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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

  it("no long dash, no secret-looking value, install in one line", () => {
    for (const file of ["README.md", "CONTRIBUTING.md"]) {
      expect(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), file).not.toMatch(/[\u2014]/);
    }
    expect(README).not.toMatch(/srn_live_[A-Za-z0-9]{8,}/);
    expect(README).not.toMatch(/0x[0-9a-fA-F]{64}/);
    expect(README).toContain("npx -y @sirenic/mcp");
  });
});

/**
 * The README: it opens on what the package is since decision C (tool definitions in the repository, each tool calls the
 * REST API and pays); its tools table is the one `npm run tableau` derives from the shipped snapshot; its free key
 * figures are the API's; no long dash.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { routePrices } from "../src/catalogue.js";
import { ERROR_CODES } from "../src/errors.js";
import { PACKAGE_NAME } from "../src/version.js";
import { priceLabel, replaceToolsTable } from "../scripts/tableau-lib.js";
import { DEVIS, SNAPSHOT } from "./helpers/fixtures.js";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("README", () => {
  it("the tools table is generated from the snapshot (else: npm run tableau)", () => {
    expect(README).toBe(replaceToolsTable(README, SNAPSHOT));
    expect(README).toContain(`${SNAPSHOT.tools.length} tools (`);
    expect(README).toContain(`read from the Sirenic server ${SNAPSHOT.server.version} on ${SNAPSHOT.generated_at.slice(0, 10)}`);
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
    const sentence = /Errors the package returns itself \(a closed list[^)]*\):([\s\S]*?)Errors of the Sirenic API/.exec(README)?.[1] ?? "";
    expect(sentence).not.toBe("");
    expect([...sentence.matchAll(/`([a-z_]+)`/g)].map((m) => m[1])).toEqual([...ERROR_CODES]);
    expect(README).toContain("it answers `payment_required: true` in `structuredContent`, with the\nAPI's `quote`");
  });

  it("the free key quota in the README is the API's, read in the recorded 402 answers (free_tier)", () => {
    for (const answer of Object.values(DEVIS.answers)) {
      const offer = answer.body.free_tier as { monthly_calls: number; monthly_value_eur: number };
      expect(README).toContain(`A free key gives ${offer.monthly_calls} calls a month, up to EUR ${offer.monthly_value_eur} of value, on most routes`);
    }
    // the only figures of the sentence: no other quota written by hand
    expect([...README.matchAll(/(\d+) calls a month/g)].map((m) => m[1])).toEqual(["150"]);
  });

  it("C: the README says what the package is (definitions here, a REST call that pays), never what 0.1.0 said", () => {
    expect(README).toContain("**Its tool definitions live in this\nrepository**");
    expect(README).toContain("**each tool calls the Sirenic REST API itself and pays for the call**");
    expect(README).not.toContain("never calls a REST route");
    expect(README).not.toMatch(/\b112 tools\b/);
    // NAF 62.01Z is computer programming (note of 11/10/2026)
    expect(README).toContain("computer programming companies (NAF 62.01Z)");
    expect(README).not.toContain("software companies (NAF 62.01Z)");
  });

  it("no long dash, no secret-looking value, install in one line", () => {
    for (const file of ["README.md", "CONTRIBUTING.md"]) {
      expect(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), file).not.toMatch(/[\u2014]/);
    }
    expect(README).not.toMatch(/srn_live_[A-Za-z0-9]{8,}/);
    expect(README).not.toMatch(/0x[0-9a-fA-F]{64}/);
    // the npm name comes from package.json: changing its `name` fails here until each line follows
    expect(README).toContain(`\`${PACKAGE_NAME}\` is a local [Model Context Protocol]`);
    expect(README).toContain(`"args": ["-y", "${PACKAGE_NAME}"]`);
    expect(README).toContain(`claude mcp add sirenic -e SIRENIC_API_KEY=srn_live_... -- npx -y ${PACKAGE_NAME}\n`);
    expect([...README.matchAll(/npx -y (\S+)/g)].map((m) => m[1])).toEqual([PACKAGE_NAME]);
    expect([...README.matchAll(/"args": \["-y", "([^"]+)"\]/g)].map((m) => m[1])).toEqual([PACKAGE_NAME]);
  });
});

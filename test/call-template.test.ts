/**
 * The shared call template analyser (src/appel-outil.ts) and its vectors (test/fixtures/mcp-appel-vecteurs.json), both
 * copied unchanged from the Sirenic server, where the same vectors are played by its own suite: a difference between the
 * two analysers fails on both sides (decision C of 15/10/2026, letter Q7 A of 17/10/2026).
 *   1. every vector: template and arguments give the expected request, or the named refusal;
 *   2. every comparison: same request or not, both ways;
 *   3. the module is pure and imports nothing (it is copied without anything else);
 *   4. every refusal reason the vectors produce has its English sentence (src/analyser-reasons.ts);
 *   5. every template of the shipped snapshot is of the closed form.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { englishReasonOrUndefined } from "../src/analyser-reasons.js";
import { CLE_META_APPEL, defautDuGabarit, memeRequete, REFUS_APPEL, requeteDeLOutil, type RequeteAppel } from "../src/appel-outil.js";
import { SNAPSHOT } from "./helpers/fixtures.js";

interface RequestVector {
  titre: string;
  gabarit: unknown;
  arguments: Record<string, unknown>;
  attendu: RequeteAppel | { refus: string };
}
interface ComparisonVector {
  titre: string;
  a: RequeteAppel;
  b: RequeteAppel;
  meme: boolean;
}
const VECTORS = JSON.parse(readFileSync(new URL("./fixtures/mcp-appel-vecteurs.json", import.meta.url), "utf8")) as {
  version: number;
  requetes: RequestVector[];
  comparaisons: ComparisonVector[];
};

describe("C: the shared call template analyser, played on the shared vectors", () => {
  it.each(VECTORS.requetes.map((v) => [v.titre, v] as const))("request: %s", (_title, v) => {
    const got = requeteDeLOutil(v.gabarit, v.arguments);
    if ("refus" in v.attendu) {
      expect(got).toMatchObject({ refus: v.attendu.refus });
      expect((got as { raison?: unknown }).raison).toEqual(expect.any(String));
    } else {
      expect(got).toEqual(v.attendu);
    }
  });

  it.each(VECTORS.comparaisons.map((v) => [v.titre, v] as const))("comparison: %s", (_title, v) => {
    expect(memeRequete(v.a, v.b)).toBe(v.meme);
    expect(memeRequete(v.b, v.a)).toBe(v.meme);
  });

  it("the vectors refuse with both codes of the closed list", () => {
    const codes = new Set(VECTORS.requetes.flatMap((v) => ("refus" in v.attendu ? [v.attendu.refus] : [])));
    expect([...codes].sort()).toEqual([...REFUS_APPEL].sort());
  });

  it("the analyser is pure: no import, no fetch, no file", () => {
    const code = readFileSync(new URL("../src/appel-outil.ts", import.meta.url), "utf8");
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\brequire\(|\bfetch\(|\bprocess\./);
  });

  it("every refusal reason of the vectors has its English sentence, so the French text never reaches the client", () => {
    const reasons = VECTORS.requetes.flatMap((v) => {
      const got = requeteDeLOutil(v.gabarit, v.arguments);
      return "refus" in got ? [got.raison] : [];
    });
    expect(reasons.length).toBeGreaterThanOrEqual(5);
    for (const reason of reasons) expect(englishReasonOrUndefined(reason), reason).toBeDefined();
  });

  it("every call template of the shipped snapshot is of the closed form", () => {
    for (const tool of SNAPSHOT.tools) expect(defautDuGabarit(tool._meta?.[CLE_META_APPEL]), tool.name).toBeNull();
  });
});

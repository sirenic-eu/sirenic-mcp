/**
 * Source guards: the package writes no file (Glama runs it in a microVM and flags disk writes; letter M7 A), calls
 * no REST route of its own (the paywall stays on the server), opens no local listener (M6 A), and its dependencies
 * are pinned to exact versions.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = new URL("../src/", import.meta.url);
const sources = readdirSync(SRC).filter((f) => f.endsWith(".ts")).map((f) => [f, readFileSync(new URL(f, SRC), "utf8")] as const);

describe("source guards", () => {
  it("no file is written: no writeFile, appendFile, createWriteStream, mkdir, rm in src/", () => {
    const writes = sources.filter(([, code]) => /\b(writeFile|appendFile|createWriteStream|mkdir|rmSync|unlink|rename)\w*\s*\(/.test(code)).map(([f]) => f);
    expect(writes).toEqual([]);
  });

  it("no REST call: the only network path is the MCP client transport (no fetch( in src/)", () => {
    expect(sources.filter(([, code]) => /\bfetch\(/.test(code)).map(([f]) => f)).toEqual([]);
    expect(sources.filter(([, code]) => code.includes("/v1/")).map(([f]) => f)).toEqual([]);
  });

  it("no local listener (letter M6 A: stdio only, an HTTP port with a wallet behind it would be reachable by any local process)", () => {
    expect(sources.filter(([, code]) => /\b(createServer|listen)\s*\(/.test(code)).map(([f]) => f)).toEqual([]);
    expect(sources.filter(([, code]) => code.includes("StdioServerTransport")).map(([f]) => f)).toEqual(["cli.ts"]);
  });

  it("dependencies pinned to exact versions", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Record<string, Record<string, string>>;
    for (const field of ["dependencies", "devDependencies"]) {
      for (const [name, version] of Object.entries(pkg[field] ?? {})) expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

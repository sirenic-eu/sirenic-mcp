/** Configuration: defaults, aliases, refusals that name the variable and never print a secret. */
import { readFileSync } from "node:fs";
import { generatePrivateKey } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { ConfigError, readConfig } from "../src/config.js";
import { formatUsd, parseUsd } from "../src/money.js";
import { PACKAGE_NAME, PACKAGE_VERSION, USER_AGENT } from "../src/version.js";

describe("configuration", () => {
  it("defaults: https://api.sirenic.eu, $0.05 per call, $0.50 per session (letter M4 A), no rail", () => {
    const c = readConfig({});
    expect(c.baseUrl.href).toBe("https://api.sirenic.eu/");
    expect(formatUsd(c.maxPerCall)).toBe("$0.05");
    expect(formatUsd(c.maxPerSession)).toBe("$0.50");
    expect(c.rail).toBe("none");
  });

  it("the key wins over the wallet, and the startup note says so", () => {
    const c = readConfig({ SIRENIC_API_KEY: "srn_live_x", SIRENIC_WALLET_KEY: generatePrivateKey() });
    expect(c.rail).toBe("key");
    expect(c.notes.join(" ")).toContain("the wallet is never used");
  });

  it("caps: French names and English aliases; two different values are refused", () => {
    expect(readConfig({ SIRENIC_MAX_PAR_APPEL: "0.1" }).maxPerCall).toBe(100000n);
    expect(readConfig({ SIRENIC_MAX_PER_SESSION: "$2" }).maxPerSession).toBe(2000000n);
    expect(() => readConfig({ SIRENIC_MAX_PAR_APPEL: "0.1", SIRENIC_MAX_PER_CALL: "0.2" })).toThrow(ConfigError);
    expect(() => readConfig({ SIRENIC_MAX_PAR_APPEL: "-1" })).toThrow(/SIRENIC_MAX_PAR_APPEL/);
  });

  it("a malformed wallet key is refused without its value in the message", () => {
    const secret = "0xnot-a-key-but-a-secret-anyway";
    try {
      readConfig({ SIRENIC_WALLET_KEY: secret });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(String(error)).not.toContain(secret);
    }
  });

  it("SIRENIC_URL: https only (http for 127.0.0.1 or localhost), an origin without path", () => {
    expect(readConfig({ SIRENIC_URL: "http://127.0.0.1:8080" }).baseUrl.href).toBe("http://127.0.0.1:8080/");
    expect(() => readConfig({ SIRENIC_URL: "http://api.sirenic.eu" })).toThrow(ConfigError);
    expect(() => readConfig({ SIRENIC_URL: "https://api.sirenic.eu/v1" })).toThrow(ConfigError);
  });

  it("amounts in atomic units of 6 decimals, without floats", () => {
    expect(parseUsd("0.002")).toBe(2000n);
    expect(parseUsd("1")).toBe(1000000n);
    expect(parseUsd("0.0000001")).toBeUndefined();
    expect(formatUsd(2000n)).toBe("$0.002");
    expect(formatUsd(100000n)).toBe("$0.10");
  });

  it("identity: package.json name and version, User-Agent sirenic-mcp-npm (counted apart by the server)", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { name: string; version: string; mcpName: string; license: string };
    expect(pkg.name).toBe(PACKAGE_NAME);
    expect(pkg.version).toBe(PACKAGE_VERSION);
    // the npm name is written once, in package.json (letter G1 B of #532: sirenic-mcp, without a scope)
    expect(readFileSync(new URL("../src/version.ts", import.meta.url), "utf8")).not.toContain(`"${PACKAGE_NAME}"`);
    expect(pkg.mcpName).toBe("eu.sirenic/sirenic");
    expect(pkg.license).toBe("MIT");
    expect(USER_AGENT).toBe(`sirenic-mcp-npm/${PACKAGE_VERSION}`);
  });
});

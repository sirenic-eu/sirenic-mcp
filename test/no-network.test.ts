/** The guard of test/setup-no-network.ts holds: no test can reach a real address. */
import net from "node:net";
import { describe, expect, it } from "vitest";
import { fakeRemote, UnregisteredAddress } from "./helpers/fake-remote.js";
import { NetworkDisabled } from "./setup-no-network.js";

describe("no network in tests", () => {
  it("the global fetch is refused, for the Sirenic server as for any address", async () => {
    await expect(fetch("https://api.sirenic.eu/mcp", { method: "POST" })).rejects.toBeInstanceOf(NetworkDisabled);
    await expect(fetch("http://127.0.0.1:9/")).rejects.toBeInstanceOf(NetworkDisabled);
  });

  it("a socket is refused before any connection", () => {
    expect(() => net.connect(443, "api.sirenic.eu")).toThrow(NetworkDisabled);
  });

  it("the simulated server refuses every address it was not given", async () => {
    const remote = fakeRemote({ tools: [], endpoints: ["https://api.sirenic.eu/mcp"] });
    await expect(remote.fetch("https://api.sirenic.eu/v1/recherche?q=danone")).rejects.toBeInstanceOf(UnregisteredAddress);
    await expect(remote.fetch("https://example.org/mcp")).rejects.toBeInstanceOf(UnregisteredAddress);
    expect(remote.requests).toEqual([]);
  });
});

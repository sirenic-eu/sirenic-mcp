/** The guard of test/setup-no-network.ts holds: no test can reach a real address. */
import dgram from "node:dgram";
import dns from "node:dns";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { fakeApi } from "./helpers/fake-api.js";
import { UnregisteredAddress } from "./helpers/fake-remote.js";
import { NetworkDisabled } from "./setup-no-network.js";

describe("no network in tests", () => {
  it("the global fetch is refused, for the Sirenic server as for any address", async () => {
    await expect(fetch("https://api.sirenic.eu/mcp", { method: "POST" })).rejects.toBeInstanceOf(NetworkDisabled);
    await expect(fetch("http://127.0.0.1:9/")).rejects.toBeInstanceOf(NetworkDisabled);
  });

  it("a socket is refused before any connection", () => {
    expect(() => net.connect(443, "api.sirenic.eu")).toThrow(NetworkDisabled);
  });

  it("every DNS query is refused (callback and promise APIs, resolvers) and so is every UDP socket", () => {
    expect(() => dns.lookup("api.sirenic.eu", () => undefined)).toThrow(NetworkDisabled);
    expect(() => dns.resolve4("api.sirenic.eu", () => undefined)).toThrow(NetworkDisabled);
    expect(() => dns.resolve("api.sirenic.eu", () => undefined)).toThrow(NetworkDisabled);
    expect(() => dns.promises.lookup("api.sirenic.eu")).toThrow(NetworkDisabled);
    expect(() => dns.promises.resolve4("api.sirenic.eu")).toThrow(NetworkDisabled);
    expect(() => new dns.Resolver().resolve4("api.sirenic.eu", () => undefined)).toThrow(NetworkDisabled);
    expect(() => new dns.promises.Resolver().resolveTxt("sirenic.eu")).toThrow(NetworkDisabled);
    expect(() => dgram.createSocket("udp4")).toThrow(NetworkDisabled);
  });

  it("the simulated API refuses every address outside /v1 of its origin, and /mcp unless it was given a tool list", async () => {
    const api = fakeApi({});
    await expect(api.fetch("https://api.sirenic.eu/mcp", { method: "POST" })).rejects.toBeInstanceOf(UnregisteredAddress);
    await expect(api.fetch("https://example.org/v1/recherche?q=danone")).rejects.toBeInstanceOf(UnregisteredAddress);
    await expect(api.fetch("https://api.sirenic.eu/compte")).rejects.toBeInstanceOf(UnregisteredAddress);
    expect(api.requests).toEqual([]);
  });
});

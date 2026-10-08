/**
 * Tests never open the network. The global fetch and every socket are refused here, before any test runs; the
 * package under test only talks to the simulated Sirenic server through an injected fetch (test/helpers/fake-remote.ts),
 * which itself refuses any address it was not given. test/no-network.test.ts proves the guard holds.
 */
import net from "node:net";
import dns from "node:dns";

export class NetworkDisabled extends Error {}

const refuse = (what: string) => (): never => {
  throw new NetworkDisabled(`network disabled in tests: ${what}`);
};

globalThis.fetch = (async (input: unknown) => {
  throw new NetworkDisabled(`network disabled in tests: fetch ${String(input instanceof Request ? input.url : input)}`);
}) as typeof fetch;
net.Socket.prototype.connect = refuse("socket connect") as unknown as typeof net.Socket.prototype.connect;
dns.lookup = refuse("dns lookup") as unknown as typeof dns.lookup;

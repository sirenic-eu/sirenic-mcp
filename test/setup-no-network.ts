/**
 * Tests never open the network. The global fetch, every TCP connection, every DNS query (callback and promise APIs,
 * resolvers) and every UDP socket are refused here, before any test runs; the package under test only talks to the
 * simulated Sirenic server through an injected fetch (test/helpers/fake-remote.ts), which itself refuses any address
 * it was not given. test/no-network.test.ts proves the guard holds.
 */
import dgram from "node:dgram";
import dns from "node:dns";
import net from "node:net";

export class NetworkDisabled extends Error {}

const refuse = (what: string) => (): never => {
  throw new NetworkDisabled(`network disabled in tests: ${what}`);
};

/** The functions of a DNS API that reach a name server: lookup, lookupService, reverse and every resolve*. */
function refuseDns(api: object, where: string): void {
  const target = api as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(api)) {
    if (/^(lookup|lookupService|reverse|resolve\w*)$/.test(name) && typeof target[name] === "function") {
      target[name] = refuse(`${where} ${name}`);
    }
  }
}

globalThis.fetch = (async (input: unknown) => {
  throw new NetworkDisabled(`network disabled in tests: fetch ${String(input instanceof Request ? input.url : input)}`);
}) as typeof fetch;
net.Socket.prototype.connect = refuse("socket connect") as unknown as typeof net.Socket.prototype.connect;
refuseDns(dns, "dns");
refuseDns(dns.promises, "dns.promises");
refuseDns(dns.Resolver.prototype, "dns.Resolver");
refuseDns(dns.promises.Resolver.prototype, "dns.promises.Resolver");
dgram.createSocket = refuse("udp socket") as unknown as typeof dgram.createSocket;

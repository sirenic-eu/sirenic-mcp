/** The local server under test, wired to a simulated API, and an MCP client in memory (the way Claude Desktop sees it). */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readConfig } from "../../src/config.js";
import { RemoteServer } from "../../src/remote.js";
import { SirenicApi } from "../../src/rest.js";
import { SirenicServer } from "../../src/server.js";
import type { Snapshot } from "../../src/snapshot.js";
import { fakeApi, type FakeApiOptions } from "./fake-api.js";
import { SNAPSHOT } from "./fixtures.js";

export interface LocalOptions {
  snapshot?: Snapshot;
  /** Whether the server reads the hosted tool list at startup (it does in the CLI); off by default in tests. */
  refresh?: boolean;
}

export async function localServer(env: Record<string, string>, apiOptions: FakeApiOptions, options: LocalOptions = {}) {
  const config = readConfig(env);
  const fake = fakeApi(apiOptions);
  const api = new SirenicApi({ baseUrl: config.baseUrl, ...(config.rail === "key" && config.apiKey ? { apiKey: config.apiKey } : {}), fetch: fake.fetch, callTimeoutMs: 2_000 });
  const remote = options.refresh ? new RemoteServer({ baseUrl: config.baseUrl, fetch: fake.fetch, listTimeoutMs: 2_000 }) : undefined;
  const logs: string[] = [];
  const local = await SirenicServer.start({ config, api, ...(remote ? { remote } : {}), snapshot: () => options.snapshot ?? SNAPSHOT, log: (l) => logs.push(l) });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await local.server.connect(serverSide);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientSide);
  return {
    client,
    local,
    api: fake,
    logs,
    close: async () => {
      await client.close();
    },
  };
}

/** The package's own error of a tool result (`structuredContent.resultat`). */
export function resultOf(r: unknown): Record<string, unknown> {
  return (r as { structuredContent: { resultat: Record<string, unknown> } }).structuredContent.resultat;
}

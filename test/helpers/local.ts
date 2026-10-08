/** The local server under test, wired to a simulated remote, and an MCP client in memory (the way Claude Desktop sees it). */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readConfig } from "../../src/config.js";
import { RemoteServer } from "../../src/remote.js";
import { SirenicServer } from "../../src/server.js";
import type { Snapshot } from "../../src/snapshot.js";
import { fakeRemote, type FakeRemoteOptions } from "./fake-remote.js";
import { SNAPSHOT } from "./fixtures.js";

export async function localServer(
  env: Record<string, string>,
  remoteOptions: FakeRemoteOptions,
  snapshot: Snapshot = SNAPSHOT,
): Promise<{ client: Client; local: SirenicServer; remote: ReturnType<typeof fakeRemote>; logs: string[]; close(): Promise<void> }> {
  const config = readConfig(env);
  const remote = fakeRemote(remoteOptions);
  const connection = new RemoteServer({ baseUrl: config.baseUrl, ...(config.apiKey ? { apiKey: config.apiKey } : {}), fetch: remote.fetch, listTimeoutMs: 2_000, callTimeoutMs: 2_000 });
  const logs: string[] = [];
  const local = await SirenicServer.start({ config, remote: connection, snapshot: () => snapshot, log: (l) => logs.push(l) });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await local.server.connect(serverSide);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientSide);
  return {
    client,
    local,
    remote,
    logs,
    close: async () => {
      await client.close();
      await connection.close();
    },
  };
}

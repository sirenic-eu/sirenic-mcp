/**
 * npm run instantane: reads tools/list from the Sirenic server and rewrites catalogue/instantane.json, the
 * snapshot shipped with the package (served only when the server cannot be reached at startup). Anonymous and
 * free: no key, no wallet, no payment. Run it before each release.
 *
 *   SIRENIC_URL=https://api.sirenic.eu npm run instantane
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readConfig } from "../src/config.js";
import { RemoteServer } from "../src/remote.js";
import { SNAPSHOT_URL, type Snapshot } from "../src/snapshot.js";

const config = readConfig({ SIRENIC_URL: process.env.SIRENIC_URL });
const remote = new RemoteServer({ baseUrl: config.baseUrl });
try {
  const client = await remote.connect();
  const list = await remote.listTools();
  const server = client.getServerVersion();
  const snapshot: Snapshot = {
    generated_at: new Date().toISOString(),
    source: remote.endpoint.href,
    server: { name: server?.name ?? "sirenic", version: server?.version ?? "unknown" },
    ...(list.instructions ? { instructions: list.instructions } : {}),
    tools: list.tools,
  };
  writeFileSync(fileURLToPath(SNAPSHOT_URL), `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`catalogue/instantane.json: ${list.tools.length} tools from ${snapshot.source} (server ${snapshot.server.version}), ${snapshot.generated_at}`);
} finally {
  await remote.close();
}

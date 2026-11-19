/**
 * npx tsx scripts/derive.ts [--rapport <file>]: compares the shipped snapshot with the free, anonymous tools/list of the
 * Sirenic server (SIRENIC_URL, https://api.sirenic.eu by default). Exit code: 0 no drift, 3 drift (the Markdown report
 * printed, and written to the file when given), anything else: the comparison could not be made (no report; the
 * workflow fails without touching any issue). Run every day by .github/workflows/derive-instantane.yml.
 */
import { writeFileSync } from "node:fs";
import { readConfig } from "../src/config.js";
import { RemoteServer } from "../src/remote.js";
import { readSnapshot } from "../src/snapshot.js";
import { compareSnapshot, driftReport, hasDrift } from "./derive-lib.js";

const NO_DRIFT = 0;
const DRIFT = 3;
const FAILED = 2;

async function main(): Promise<number> {
  const i = process.argv.indexOf("--rapport");
  const file = i >= 0 ? process.argv[i + 1] : undefined;
  if (i >= 0 && !file) throw new Error("--rapport needs a file name");
  const config = readConfig({ SIRENIC_URL: process.env.SIRENIC_URL });
  const snapshot = readSnapshot();
  const remote = new RemoteServer({ baseUrl: config.baseUrl });
  try {
    const list = await remote.listTools();
    const read = { ...list, readAt: new Date().toISOString(), source: remote.endpoint.href };
    const drift = compareSnapshot(snapshot, read);
    if (!hasDrift(drift)) {
      console.log(`No drift: ${snapshot.tools.length} tools in the snapshot of ${snapshot.generated_at}, equal to ${read.source} (server ${read.serverVersion ?? "unknown"}).`);
      return NO_DRIFT;
    }
    const report = driftReport(snapshot, read, drift);
    process.stdout.write(report);
    if (file) writeFileSync(file, report);
    return DRIFT;
  } finally {
    await remote.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`The comparison could not be made: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = FAILED;
  },
);

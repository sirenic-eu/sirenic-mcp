/**
 * The comparison of the shipped snapshot with the server's tools/list, for the daily drift workflow
 * (.github/workflows/derive-instantane.yml, scripts/derive.ts). Any difference a client would see counts: a tool added or
 * withdrawn, a description, a schema, a call template, a price, the server's instructions. Key order counts where it
 * carries meaning (the `properties` of a schema and the `requete` of a call template, r2 of the review of 18/10/2026),
 * nowhere else. A new server version with nothing else changed is not a drift.
 */
import { createHash } from "node:crypto";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { canonicalJson } from "../src/canonical.js";
import type { Snapshot } from "../src/snapshot.js";

export interface RemoteRead {
  tools: Tool[];
  instructions?: string;
  serverVersion?: string;
  readAt: string;
  source: string;
}

export interface Drift {
  added: string[];
  removed: string[];
  /** Tool name and the fields that differ (`_meta` named by its key). */
  changed: Array<{ name: string; fields: string[] }>;
  instructionsChanged: boolean;
}

function fieldsThatDiffer(a: Tool, b: Tool): string[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== "name").sort();
  const fields: string[] = [];
  for (const key of keys) {
    const x = (a as Record<string, unknown>)[key];
    const y = (b as Record<string, unknown>)[key];
    if (canonicalJson(x) === canonicalJson(y)) continue;
    if (key === "_meta" && x && y && typeof x === "object" && typeof y === "object") {
      const metaKeys = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
      for (const m of metaKeys) {
        if (canonicalJson((x as Record<string, unknown>)[m]) !== canonicalJson((y as Record<string, unknown>)[m])) fields.push(`_meta ${m}`);
      }
    } else {
      fields.push(key);
    }
  }
  return fields;
}

export function compareSnapshot(snapshot: Snapshot, remote: RemoteRead): Drift {
  const local = new Map(snapshot.tools.map((t) => [t.name, t]));
  const there = new Map(remote.tools.map((t) => [t.name, t]));
  const added = remote.tools.map((t) => t.name).filter((n) => !local.has(n));
  const removed = snapshot.tools.map((t) => t.name).filter((n) => !there.has(n));
  const changed: Drift["changed"] = [];
  for (const tool of snapshot.tools) {
    const other = there.get(tool.name);
    if (!other) continue;
    const fields = fieldsThatDiffer(tool, other);
    if (fields.length > 0) changed.push({ name: tool.name, fields });
  }
  return { added, removed, changed, instructionsChanged: (snapshot.instructions ?? "") !== (remote.instructions ?? "") };
}

export function hasDrift(d: Drift): boolean {
  return d.added.length > 0 || d.removed.length > 0 || d.changed.length > 0 || d.instructionsChanged;
}

/** At most this many characters of report (an issue body holds 65 536). */
export const REPORT_LIMIT = 60_000;

/** The Markdown report of a drift; its first line carries a fingerprint of the differences (not of the dates), so the
 *  workflow comments only when they change. */
export function driftReport(snapshot: Snapshot, remote: RemoteRead, d: Drift): string {
  const fingerprint = createHash("sha256").update(canonicalJson(d)).digest("hex").slice(0, 16);
  const names = (list: string[]) => (list.length ? list.map((n) => `\`${n}\``).join(", ") : "none");
  const lines = [
    `<!-- drift fingerprint: ${fingerprint} -->`,
    "## The snapshot differs from the Sirenic server",
    "",
    `Snapshot of ${snapshot.generated_at} (server ${snapshot.server.version}) against the tools/list of ${remote.source} read at ${remote.readAt} (server ${remote.serverVersion ?? "unknown"}).`,
    "",
    `- Tools on the server, not in the snapshot (${d.added.length}): ${names(d.added)}`,
    `- Tools in the snapshot, withdrawn from the server (${d.removed.length}): ${names(d.removed)}`,
    `- Tools that changed (${d.changed.length}):${d.changed.length ? "" : " none"}`,
    ...d.changed.map((c) => `  - \`${c.name}\`: ${c.fields.join(", ")}`),
    `- Server instructions: ${d.instructionsChanged ? "changed" : "unchanged"}`,
    "",
    "To update: `npm run instantane && npm run tableau`, then a pull request with the new snapshot, the README table and a CHANGELOG line that says what changes for clients. Until a version with the new snapshot is published, a tool whose call template or schema changed is withdrawn at startup, and a tool added on the server is not served.",
  ];
  const text = `${lines.join("\n")}\n`;
  return text.length <= REPORT_LIMIT ? text : `${text.slice(0, REPORT_LIMIT)}\n\n(report cut at ${REPORT_LIMIT} characters)\n`;
}

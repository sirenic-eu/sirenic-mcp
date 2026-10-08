/**
 * npm run tableau: rewrites the tools table of README.md, between its two markers, from the shipped snapshot
 * (catalogue/instantane.json). Never edited by hand: test/readme.test.ts fails when the table and the snapshot differ.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readSnapshot } from "../src/snapshot.js";
import { replaceToolsTable } from "./tableau-lib.js";

const README = fileURLToPath(new URL("../README.md", import.meta.url));
const snapshot = readSnapshot();
writeFileSync(README, replaceToolsTable(readFileSync(README, "utf8"), snapshot));
console.log(`README.md: table of ${snapshot.tools.length} tools, snapshot of ${snapshot.generated_at}`);

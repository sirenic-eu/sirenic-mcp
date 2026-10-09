/**
 * Package identity, read from package.json: its `name` is the only field to change if the npm name changes
 * (`sirenic-mcp`, without a scope: letter G1 B of #532), and test/readme.test.ts then names the README lines that must
 * follow. package.json ships in every npm package and in the Docker image, next to dist/.
 */
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { name: string; version: string };

export const PACKAGE_NAME: string = manifest.name;
export const PACKAGE_VERSION: string = manifest.version;

/**
 * How this package introduces itself to the Sirenic server: MCP `clientInfo.name` and HTTP `User-Agent`.
 * The server counts calls and sign-ups coming from this package apart from other MCP clients.
 */
export const CLIENT_NAME = "sirenic-mcp-npm";
export const USER_AGENT = `${CLIENT_NAME}/${PACKAGE_VERSION}`;

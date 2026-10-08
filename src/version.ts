/** Package identity. The version is checked against package.json by test/config.test.ts. */
export const PACKAGE_NAME = "@sirenic/mcp";
export const PACKAGE_VERSION = "0.1.0";

/**
 * How this package introduces itself to the Sirenic server: MCP `clientInfo.name` and HTTP `User-Agent`.
 * The server counts calls and sign-ups coming from this package apart from other MCP clients.
 */
export const CLIENT_NAME = "sirenic-mcp-npm";
export const USER_AGENT = `${CLIENT_NAME}/${PACKAGE_VERSION}`;

#!/usr/bin/env node
/**
 * sirenic-mcp: the Sirenic MCP server, local (stdio). Configuration by environment variables only (see README).
 * stdout carries the MCP protocol; every human line goes to stderr, and never prints a secret.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, readConfig } from "./config.js";
import { formatUsd } from "./money.js";
import { RemoteServer } from "./remote.js";
import { SirenicServer } from "./server.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./version.js";

const HELP = `${PACKAGE_NAME} ${PACKAGE_VERSION}: Sirenic MCP server (stdio)

Environment variables (all optional):
  SIRENIC_API_KEY          Sirenic API key (srn_live_...): pays with prepaid credits and the free monthly quota.
  SIRENIC_WALLET_KEY       Private key of a local x402 wallet (USDC on Base), used when no API key is set.
  SIRENIC_MAX_PAR_APPEL    x402 cap per call in USD, default 0.05 (alias SIRENIC_MAX_PER_CALL).
  SIRENIC_MAX_PAR_SESSION  x402 cap per session in USD, default 0.50 (alias SIRENIC_MAX_PER_SESSION).
  SIRENIC_URL              Sirenic server, default https://api.sirenic.eu.
`;

function err(line: string): void {
  process.stderr.write(`sirenic-mcp: ${line}\n`);
}

async function main(): Promise<void> {
  const flag = process.argv[2];
  if (flag === "--version" || flag === "-v") {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return;
  }
  if (flag === "--help" || flag === "-h") {
    process.stdout.write(HELP);
    return;
  }
  let config;
  try {
    config = readConfig(process.env);
  } catch (error) {
    err(error instanceof ConfigError ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  for (const note of config.notes) err(note);
  const remote = new RemoteServer({ baseUrl: config.baseUrl, ...(config.apiKey ? { apiKey: config.apiKey } : {}) });
  const local = await SirenicServer.start({ config, remote, log: err });
  const c = local.tools;
  err(
    `${PACKAGE_VERSION}, ${c.tools.length} tools from ${c.source === "remote" ? `${remote.endpoint.href} (server ${c.serverVersion ?? "?"})` : `the snapshot of ${c.snapshotDate}`}, rail: ${config.rail}` +
      (config.rail === "wallet" ? ` (caps ${formatUsd(config.maxPerCall)} per call, ${formatUsd(config.maxPerSession)} per session)` : ""),
  );
  const transport = new StdioServerTransport();
  await local.server.connect(transport);
  const stop = async (): Promise<void> => {
    await local.server.close().catch(() => undefined);
    await remote.close();
  };
  process.stdin.on("end", () => void stop());
  process.on("SIGINT", () => void stop().then(() => process.exit(0)));
  process.on("SIGTERM", () => void stop().then(() => process.exit(0)));
}

main().catch((error: unknown) => {
  err(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

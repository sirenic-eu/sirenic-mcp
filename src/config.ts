/**
 * Configuration, read from environment variables only. Nothing is read from or written to a file, and no
 * value of a secret variable is ever printed: errors name the variable, never its content.
 */
import { formatUsd, parseUsd } from "./money.js";

export type Rail = "key" | "wallet" | "none";

export interface Config {
  /** Origin of the Sirenic server, e.g. https://api.sirenic.eu */
  baseUrl: URL;
  /** API key rail (prepaid credits, free monthly quota). Wins over the wallet. */
  apiKey?: string;
  /** x402 rail: private key of a local wallet (USDC on Base). */
  walletKey?: `0x${string}`;
  /** x402 cap per call, in atomic units (6 decimals). */
  maxPerCall: bigint;
  /** x402 cap for the whole session (the life of this server process), in atomic units. */
  maxPerSession: bigint;
  /** The rail that pays: the key when set, else the wallet when set, else none (quotes come back to the client). */
  rail: Rail;
  /** Startup notes for stderr (never a secret). */
  notes: string[];
}

export const DEFAULT_SIRENIC_URL = "https://api.sirenic.eu";
export const DEFAULT_MAX_PER_CALL = "0.05";
export const DEFAULT_MAX_PER_SESSION = "0.50";

/** The two caps: the documented name first, then its English alias. */
export const CAP_PER_CALL_VARIABLES = ["SIRENIC_MAX_PAR_APPEL", "SIRENIC_MAX_PER_CALL"] as const;
export const CAP_PER_SESSION_VARIABLES = ["SIRENIC_MAX_PAR_SESSION", "SIRENIC_MAX_PER_SESSION"] as const;

export class ConfigError extends Error {
  readonly code = "configuration_invalide";
}

type Env = Readonly<Record<string, string | undefined>>;

function present(env: Env, name: string): string | undefined {
  const value = env[name];
  return value !== undefined && value.trim() !== "" ? value.trim() : undefined;
}

function readCap(env: Env, names: readonly [string, string], fallback: string): bigint {
  const [main, alias] = names;
  const a = present(env, main);
  const b = present(env, alias);
  if (a !== undefined && b !== undefined && parseUsd(a) !== parseUsd(b)) {
    throw new ConfigError(`${main} and ${alias} are both set, to different amounts: keep one of them.`);
  }
  const text = a ?? b ?? fallback;
  const amount = parseUsd(text);
  if (amount === undefined) throw new ConfigError(`${a !== undefined ? main : alias} must be an amount in USD, such as 0.05.`);
  return amount;
}

function readBaseUrl(env: Env): URL {
  const text = present(env, "SIRENIC_URL") ?? DEFAULT_SIRENIC_URL;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ConfigError("SIRENIC_URL must be an absolute URL, such as https://api.sirenic.eu.");
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new ConfigError("SIRENIC_URL must use https (plain http is only accepted for 127.0.0.1 or localhost).");
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new ConfigError("SIRENIC_URL must be an origin only, such as https://api.sirenic.eu, without path, query or credentials.");
  }
  return new URL(url.origin);
}

export function readConfig(env: Env): Config {
  const baseUrl = readBaseUrl(env);
  const apiKey = present(env, "SIRENIC_API_KEY");
  if (apiKey !== undefined && (/\s/.test(apiKey) || apiKey.length > 200)) {
    throw new ConfigError("SIRENIC_API_KEY is malformed (a Sirenic key looks like srn_live_...).");
  }
  const wallet = present(env, "SIRENIC_WALLET_KEY");
  if (wallet !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(wallet)) {
    throw new ConfigError("SIRENIC_WALLET_KEY must be a private key: 0x followed by 64 hexadecimal characters.");
  }
  const maxPerCall = readCap(env, CAP_PER_CALL_VARIABLES, DEFAULT_MAX_PER_CALL);
  const maxPerSession = readCap(env, CAP_PER_SESSION_VARIABLES, DEFAULT_MAX_PER_SESSION);
  const notes: string[] = [];
  let rail: Rail = "none";
  if (apiKey !== undefined) {
    rail = "key";
    if (wallet !== undefined) notes.push("SIRENIC_API_KEY and SIRENIC_WALLET_KEY are both set: the API key pays, the wallet is never used.");
  } else if (wallet !== undefined) {
    rail = "wallet";
    notes.push(`x402 caps: ${formatUsd(maxPerCall)} per call, ${formatUsd(maxPerSession)} per session.`);
  } else {
    notes.push("No SIRENIC_API_KEY nor SIRENIC_WALLET_KEY: tools are listed, paid calls return their price and how to pay.");
  }
  return {
    baseUrl,
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(wallet !== undefined ? { walletKey: wallet as `0x${string}` } : {}),
    maxPerCall,
    maxPerSession,
    rail,
    notes,
  };
}

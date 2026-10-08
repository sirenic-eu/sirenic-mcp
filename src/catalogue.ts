/**
 * The catalogue the local server exposes: the remote `tools/list`, tool for tool (names, titles, descriptions,
 * schemas, annotations, `_meta` with each tool's routes and prices), minus the two payment parameters the
 * package handles itself (`x_payment`, `api_key`): the model never handles a key or a signature.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/** The arguments the package owns: never exposed to the model, never forwarded from it. */
export const PAYMENT_ARGUMENTS = ["x_payment", "api_key"] as const;

export interface Catalogue {
  tools: Tool[];
  /** Where the list comes from: the server at startup, or the shipped snapshot. */
  source: "remote" | "snapshot";
  /** The server's instructions (citation rule), when known. */
  instructions?: string;
  /** Date of the snapshot, when the list comes from it. */
  snapshotDate?: string;
  /** serverInfo.version of the server the list comes from. */
  serverVersion?: string;
}

export function toLocalTool(tool: Tool): Tool {
  const schema = tool.inputSchema;
  const properties = { ...(schema.properties ?? {}) };
  for (const name of PAYMENT_ARGUMENTS) delete properties[name];
  const required = schema.required?.filter((name) => !(PAYMENT_ARGUMENTS as readonly string[]).includes(name));
  const { required: _drop, ...rest } = schema;
  return {
    ...tool,
    inputSchema: { ...rest, properties, ...(required && required.length > 0 ? { required } : {}) },
  };
}

/** Removes anything the model may have put in the payment arguments. */
export function withoutPaymentArguments(args: Record<string, unknown> | undefined): Record<string, unknown> {
  const clean = { ...(args ?? {}) };
  for (const name of PAYMENT_ARGUMENTS) delete clean[name];
  return clean;
}

/** How a price that depends on a parameter is formed, as the server states it (duration tiers, or blocks and a cap). */
export type PriceRule =
  | { selon: "duree"; parametre: string; paliers: Record<string, string>; defaut: number }
  | { selon: "blocs"; parametre: string; blocs: Record<string, string>; plafond: string };

/** Each tool's price as the server states it in `_meta["eu.sirenic/prix"]`, for display only (README table). */
export interface RoutePrice {
  /** The price of a call (of an entity for a batch), or the base price when it depends on a parameter. */
  prix: string;
  par: "appel" | "entite";
  devis_max: string;
  /** Only when the price depends on a parameter: the highest price (per entity), or the cap of a call. */
  prix_max?: string;
  regle?: PriceRule;
}

export function routePrices(tool: Tool): Record<string, RoutePrice> | undefined {
  const value = tool._meta?.["eu.sirenic/prix"];
  return value !== null && typeof value === "object" ? (value as Record<string, RoutePrice>) : undefined;
}

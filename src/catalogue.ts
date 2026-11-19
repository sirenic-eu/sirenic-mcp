/**
 * The catalogue the local server exposes. Its source is the snapshot shipped in this repository
 * (catalogue/instantane.json, generated from the Sirenic server's tools/list by `npm run instantane`, never written by
 * hand): each tool's name, description, input schema and call template (`_meta["eu.sirenic/appel"]`: method, path, query
 * parameters, Accept), from which the package calls the Sirenic REST API itself (rest.ts).
 *
 * A tool is served only if it can be called the way the hosted server calls it: a call template of the closed form
 * (the shared analyser, appel-outil.ts), an input schema made of known keywords only (arguments.ts), and the two agreeing
 * (every path argument is a required property, every query parameter is a property, every property is placed in the
 * path or the query). Any other tool is excluded and named at startup, never called by guess.
 *
 * The two payment parameters of the hosted tools (`x_payment`, `api_key`) are removed from the schemas served: the
 * model never handles a key or a signature, the package does.
 *
 * At startup the package may read the hosted tools/list again (remote.ts) to bring the list up to date, never as the
 * source of a call: a tool the server no longer serves is withdrawn, a tool whose template or schema changed on the
 * server is withdrawn too (this version would call it the old way; a parameter description alone is not a change), a tool added on the server is named but not served
 * (no template written here), and descriptions and titles are refreshed.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { englishReason } from "./analyser-reasons.js";
import { CLE_META_APPEL, defautDuGabarit, type AppelOutil } from "./appel-outil.js";
import { schemaDefect } from "./arguments.js";
import { canonicalJson, schemaShape } from "./canonical.js";
import type { Snapshot } from "./snapshot.js";

/** The arguments the package owns: never exposed to the model, never forwarded from it. */
export const PAYMENT_ARGUMENTS = ["x_payment", "api_key"] as const;

/** A tool the local server serves: its definition as listed, and what a call needs. */
export interface ServedTool {
  /** As listed to the client (payment parameters removed). */
  tool: Tool;
  /** The call template, from the snapshot. */
  template: AppelOutil;
  /** The input schema the arguments are read through (the listed one). */
  schema: Tool["inputSchema"];
}

export interface Exclusion {
  name: string;
  reason: string;
}

export interface Catalogue {
  tools: Tool[];
  byName: ReadonlyMap<string, ServedTool>;
  /** Tools of the snapshot this package does not serve, and why. */
  excluded: Exclusion[];
  /** Date of the snapshot the definitions come from. */
  snapshotDate: string;
  /** serverInfo.version of the server the snapshot was read from. */
  serverVersion: string;
  /** The server's instructions (citation rule). */
  instructions?: string;
  /** Whether the list was brought up to date from the hosted tools/list at startup. */
  refreshed: boolean;
}

/** The tool as served: the payment parameters removed from its input schema. */
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

export function callTemplateOf(tool: Tool): unknown {
  return tool._meta?.[CLE_META_APPEL];
}

/** The arguments a template places in the path (`{name}` segments). */
function pathArguments(template: AppelOutil): string[] {
  return template.chemin
    .slice(1)
    .split("/")
    .map((segment) => /^\{([a-z][a-z0-9_]*)\}$/.exec(segment)?.[1])
    .filter((name): name is string => name !== undefined);
}

/** Why a tool (as served, payment parameters removed) cannot be called by this package, or null. */
export function toolDefect(tool: Tool): string | null {
  const template = callTemplateOf(tool);
  if (template === undefined) return "no call template (_meta eu.sirenic/appel)";
  const templateDefect = defautDuGabarit(template);
  if (templateDefect !== null) return `call template: ${englishReason(templateDefect)}`;
  const schemaProblem = schemaDefect(tool.inputSchema);
  if (schemaProblem !== null) return schemaProblem;
  if (tool.inputSchema.type !== "object") return "inputSchema: not an object schema";
  const t = template as AppelOutil;
  const properties = Object.keys(tool.inputSchema.properties ?? {});
  const required = new Set(tool.inputSchema.required ?? []);
  const inPath = pathArguments(t);
  const inQuery = Object.keys(t.requete ?? {});
  for (const name of inPath) {
    if (!properties.includes(name)) return `path argument ${name} is not a property of the input schema`;
    if (!required.has(name)) return `path argument ${name} is not required by the input schema`;
  }
  for (const name of inQuery) if (!properties.includes(name)) return `query parameter ${name} is not a property of the input schema`;
  for (const name of properties) if (!inPath.includes(name) && !inQuery.includes(name)) return `property ${name} is not placed by the call template`;
  return null;
}

/** The catalogue of the snapshot: every tool that can be called, the others named with their reason. */
export function catalogueFromSnapshot(snapshot: Snapshot): Catalogue {
  const byName = new Map<string, ServedTool>();
  const tools: Tool[] = [];
  const excluded: Exclusion[] = [];
  for (const raw of snapshot.tools) {
    const tool = toLocalTool(raw);
    const defect = byName.has(tool.name) ? "listed twice in the snapshot" : toolDefect(tool);
    if (defect !== null) {
      excluded.push({ name: tool.name, reason: defect });
      continue;
    }
    byName.set(tool.name, { tool, template: callTemplateOf(tool) as AppelOutil, schema: tool.inputSchema });
    tools.push(tool);
  }
  return {
    tools,
    byName,
    excluded,
    snapshotDate: snapshot.generated_at,
    serverVersion: snapshot.server.version,
    ...(snapshot.instructions ? { instructions: snapshot.instructions } : {}),
    refreshed: false,
  };
}

/** The hosted tools/list, as remote.ts reads it. */
export interface RemoteList {
  tools: Tool[];
  instructions?: string;
  serverVersion?: string;
}

/**
 * The catalogue brought up to date from the hosted tools/list (never a source of calls), and the lines that say what
 * changed. A server that does not publish call templates (older than this package) only refreshes descriptions.
 */
export function refreshCatalogue(catalogue: Catalogue, remote: RemoteList): { catalogue: Catalogue; notes: string[] } {
  const remoteByName = new Map(remote.tools.map((t) => [t.name, t]));
  const byName = new Map<string, ServedTool>();
  const tools: Tool[] = [];
  const withdrawn: string[] = [];
  const changed: string[] = [];
  for (const served of catalogue.tools) {
    const entry = catalogue.byName.get(served.name)!;
    const there = remoteByName.get(served.name);
    if (!there) {
      withdrawn.push(served.name);
      continue;
    }
    const local = toLocalTool(there);
    const remoteTemplate = callTemplateOf(local);
    if (
      remoteTemplate !== undefined &&
      (canonicalJson(remoteTemplate) !== canonicalJson(entry.template) || canonicalJson(schemaShape(local.inputSchema)) !== canonicalJson(schemaShape(entry.schema)))
    ) {
      changed.push(served.name);
      continue;
    }
    const tool: Tool = {
      ...entry.tool,
      ...(typeof there.description === "string" ? { description: there.description } : {}),
      ...(typeof there.title === "string" ? { title: there.title } : {}),
    };
    byName.set(tool.name, { ...entry, tool });
    tools.push(tool);
  }
  const known = new Set([...catalogue.tools.map((t) => t.name), ...catalogue.excluded.map((e) => e.name)]);
  const added = remote.tools.map((t) => t.name).filter((name) => !known.has(name));
  const notes: string[] = [];
  if (withdrawn.length > 0) notes.push(`withdrawn by the Sirenic server, not served: ${withdrawn.join(", ")}`);
  if (changed.length > 0) notes.push(`changed on the Sirenic server since the snapshot (call template or input schema), not served until this package is updated: ${changed.join(", ")}`);
  if (added.length > 0) notes.push(`added on the Sirenic server, served by a later version of this package: ${added.join(", ")}`);
  return {
    catalogue: {
      ...catalogue,
      tools,
      byName,
      ...(remote.instructions ? { instructions: remote.instructions } : {}),
      refreshed: true,
    },
    notes,
  };
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

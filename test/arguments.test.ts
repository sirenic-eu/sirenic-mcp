/**
 * The arguments are read through the tool's input schema with the semantics of the hosted server (choice Q4 A of
 * 18/10/2026, r2 of the review of lot 1): unknown keys dropped, object keys in the schema's order, defaults applied,
 * wrong values refused. The oracle is the hosted server's own stack: an McpServer of the same SDK with zod schemas,
 * whose tools/list gives the JSON Schema this package reads, and whose handler receives the arguments zod parsed. The
 * hosted server is on zod 4 (4.6.7 on 19/11/2026): the oracle uses zod/v4.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { KNOWN_KEYWORDS, readArguments, schemaDefect } from "../src/arguments.js";
import { toLocalTool } from "../src/catalogue.js";
import { SNAPSHOT } from "./helpers/fixtures.js";

/** Shapes written the way the hosted tools write theirs: every keyword of the closed list is used at least once. */
const SHAPES = {
  identite: {
    siren: z.string().regex(/^\d{9}$/).describe("SIREN"),
    vue: z.enum(["synthese", "complete"]).default("synthese"),
    langue: z.string().min(2).max(2).optional(),
  },
  liste: {
    sirens: z.array(z.string().regex(/^\d{9}$/)).min(2).max(5),
    inclure_cesses: z.boolean().optional(),
    limite: z.number().int().min(1).max(100).optional(),
    seuil: z.number().min(0).max(1).optional(),
  },
  criteres: {
    criteres: z
      .array(
        z.object({
          champ: z.enum(["naf", "effectif", "ville"]),
          valeur: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()])).max(3)]),
        }),
      )
      .max(4),
    webhook: z.string().url().optional(),
  },
  // two options that overlap: zod keeps the first that accepts the value, and strips what that option does not declare
  union: {
    forme: z.union([z.object({ a: z.string() }), z.object({ a: z.string(), b: z.string() })]),
  },
} as const;

type ShapeName = keyof typeof SHAPES;

async function oracle(): Promise<{ schemas: Record<ShapeName, unknown>; parse(name: ShapeName, args: unknown): Promise<{ ok: true; value: unknown } | { ok: false }> }> {
  const server = new McpServer({ name: "oracle", version: "0.0.0" });
  let seen: unknown;
  const handler = async (args: unknown) => {
    seen = args;
    return { content: [{ type: "text" as const, text: "ok" }] };
  };
  server.registerTool("identite", { inputSchema: SHAPES.identite }, handler);
  server.registerTool("liste", { inputSchema: SHAPES.liste }, handler);
  server.registerTool("criteres", { inputSchema: SHAPES.criteres }, handler);
  server.registerTool("union", { inputSchema: SHAPES.union }, handler);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "oracle-client", version: "0.0.0" });
  await client.connect(a);
  const { tools } = await client.listTools();
  const schemas = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema])) as Record<ShapeName, unknown>;
  return {
    schemas,
    async parse(name, args) {
      seen = undefined;
      const r = await client.callTool({ name, arguments: args as Record<string, unknown> });
      return r.isError ? { ok: false } : { ok: true, value: seen };
    },
  };
}

const CASES: Array<[ShapeName, unknown]> = [
  ["identite", { siren: "552032534" }],
  ["identite", { langue: "fr", vue: "complete", siren: "552032534", inconnu: 1 }],
  ["identite", { siren: "55203253" }],
  ["identite", { siren: 552032534 }],
  ["identite", { siren: "552032534", vue: "autre" }],
  ["identite", { siren: "552032534", langue: "fra" }],
  ["identite", {}],
  ["liste", { sirens: ["552032534", "542051180"], limite: 10, inclure_cesses: true }],
  ["liste", { limite: 10, sirens: ["552032534", "542051180"], seuil: 0.5, x_payment: "x" }],
  ["liste", { sirens: ["552032534"] }],
  ["liste", { sirens: ["552032534", "542051180"], limite: 1.5 }],
  ["liste", { sirens: ["552032534", "542051180"], limite: 0 }],
  ["liste", { sirens: ["552032534", "542051180"], seuil: 2 }],
  ["liste", { sirens: ["552032534", "542051180"], inclure_cesses: "true" }],
  ["liste", { sirens: ["552032534", "x"] }],
  ["criteres", { criteres: [{ valeur: "62.01Z", champ: "naf", autre: true }, { champ: "effectif", valeur: 10 }] }],
  ["criteres", { criteres: [{ champ: "ville", valeur: ["Lyon", 69] }], webhook: "https://example.org/hook" }],
  ["criteres", { criteres: [{ champ: "ville", valeur: ["a", "b", "c", "d"] }] }],
  ["criteres", { criteres: [{ champ: "ville", valeur: { objet: 1 } }] }],
  ["criteres", { criteres: [{ champ: "pays", valeur: "FR" }] }],
  ["criteres", { criteres: [], webhook: "not a url" }],
  ["criteres", { criteres: [{ champ: "naf", valeur: true }], extra: [1, 2] }],
  ["union", { forme: { a: "x", b: "y" } }],
  ["union", { forme: { b: "y" } }],
];

describe("Q4 A: the arguments read with the hosted server's semantics", () => {
  it("the oracle's schemas use every keyword of the closed list, and none other", async () => {
    const { schemas } = await oracle();
    const used = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node === null || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node)) {
        used.add(k);
        if (k === "properties") Object.values(v as object).forEach(walk);
        else if (k === "items" || k === "anyOf") walk(v);
      }
    };
    Object.values(schemas).forEach(walk);
    expect([...used].sort()).toEqual([...KNOWN_KEYWORDS].sort());
    for (const s of Object.values(schemas)) expect(schemaDefect(s)).toBeNull();
  });

  it.each(CASES.map((c, i) => [i, ...c] as const))("case %i (%s): same acceptance and same output, key order included, as zod through the SDK", async (_i, name, args) => {
    const o = await oracle();
    const expected = await o.parse(name, args);
    const got = readArguments(o.schemas[name], args as Record<string, unknown>);
    expect(got.ok).toBe(expected.ok);
    if (expected.ok && got.ok) {
      expect(got.value).toEqual(expected.value);
      expect(JSON.stringify(got.value)).toBe(JSON.stringify(expected.value));
    }
  });

  it("a refusal names the argument and never repeats its value", () => {
    const schema = toLocalTool(SNAPSHOT.tools.find((t) => t.name === "get_french_company_profile")!).inputSchema;
    const r = readArguments(schema, { siren: "secret-looking-value-123" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/^siren: /);
    expect(!r.ok && r.reason).not.toContain("secret-looking-value-123");
    const missing = readArguments(schema, {});
    expect(!missing.ok && missing.reason).toBe("siren: required");
  });

  it("every schema of the shipped snapshot is made of known keywords only", () => {
    for (const tool of SNAPSHOT.tools) expect(schemaDefect(toLocalTool(tool).inputSchema), tool.name).toBeNull();
  });

  it("a keyword out of the list, a format other than uri, a required name that is not a property: the schema is refused", () => {
    expect(schemaDefect({ type: "object", properties: { a: { type: "string" } }, additionalProperties: false })).toBe("inputSchema: unknown keyword additionalProperties");
    expect(schemaDefect({ type: "object", properties: { a: { type: "string", format: "email" } } })).toBe("inputSchema.a: unknown format email");
    expect(schemaDefect({ type: "object", properties: {}, required: ["a"] })).toBe("inputSchema: required a is not a property");
    expect(schemaDefect({ type: "object", properties: { a: { type: ["string", "null"] } } })).toBe("inputSchema.a: unknown type null");
    expect(schemaDefect({ type: "object", properties: { a: { type: "string", pattern: "(" } } })).toBe("inputSchema.a: pattern does not compile");
  });
});

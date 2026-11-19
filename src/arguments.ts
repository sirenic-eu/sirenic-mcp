/**
 * The arguments of a tool call, read through the tool's input schema before the call template turns them into a request,
 * with the semantics of the hosted Sirenic server (its tools are zod 4 schemas, parsed by the MCP SDK):
 *   - a key the schema does not declare is dropped (the payment arguments `x_payment` and `api_key` among them);
 *   - the keys of an object come out in the order of the schema's `properties`, the order the query string is written in
 *     (the quote is signed over the request, so its bytes matter);
 *   - a missing optional property with a `default` takes it; a URL comes out as zod 4 gives it (blanks at both ends and
 *     tabs and line breaks removed); of two union options, the first that accepts the value gives the output;
 *   - a value of the wrong type, out of its bounds or outside its enum is refused, naming the argument, never its value.
 * One deliberate difference: a served `pattern` has lost the flags of the zod regex (the hosted server matches some
 * identifiers case-insensitively, and JSON Schema cannot say so), so a value that matches only case-insensitively is let
 * through and the API judges it (an invalid value is answered 400 and never charged).
 *
 * Seventeen JSON Schema keywords are known (KNOWN_KEYWORDS, a closed list: the ones the served schemas use, measured on
 * the snapshot). A schema with any other keyword is not interpreted: its tool is not served (catalogue.ts names it at
 * startup), rather than being called with arguments read the wrong way.
 */

export const KNOWN_KEYWORDS = [
  "$schema",
  "anyOf",
  "default",
  "description",
  "enum",
  "format",
  "items",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "pattern",
  "properties",
  "required",
  "type",
] as const;

const KNOWN = new Set<string>(KNOWN_KEYWORDS);
const TYPES = new Set(["object", "string", "integer", "number", "boolean", "array"]);
/** `format` values a zod schema emits and this reader checks: `uri` (zod `.url()`). */
const FORMATS = new Set(["uri"]);

type Schema = Record<string, unknown>;

export type ArgumentsReading = { ok: true; value: Record<string, unknown> } | { ok: false; reason: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isScalar(v: unknown): boolean {
  return typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
}

function typesOf(schema: Schema): string[] {
  const t = schema.type;
  return t === undefined ? [] : Array.isArray(t) ? (t as string[]) : [t as string];
}

function isBound(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * What keeps a schema from being read here, or null: a keyword out of the closed list, a malformed one, a `required`
 * name that is not a property, a pattern that does not compile, a format other than `uri`. `path` names the place.
 */
export function schemaDefect(schema: unknown, path = "inputSchema"): string | null {
  if (!isObject(schema)) return `${path}: not a schema object`;
  for (const key of Object.keys(schema)) if (!KNOWN.has(key)) return `${path}: unknown keyword ${key}`;
  const types = typesOf(schema);
  if (types.length === 0 && schema.anyOf === undefined && schema.enum === undefined) return `${path}: no type`;
  for (const t of types) if (typeof t !== "string" || !TYPES.has(t)) return `${path}: unknown type ${String(t)}`;
  for (const bound of ["minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum"]) {
    if (schema[bound] !== undefined && !isBound(schema[bound])) return `${path}: ${bound} is not a number`;
  }
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== "string") return `${path}: pattern is not a string`;
    try {
      new RegExp(schema.pattern);
    } catch {
      return `${path}: pattern does not compile`;
    }
  }
  if (schema.format !== undefined && !(typeof schema.format === "string" && FORMATS.has(schema.format))) {
    return `${path}: unknown format ${String(schema.format)}`;
  }
  if (schema.enum !== undefined && !(Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every(isScalar))) {
    return `${path}: enum is not a list of values`;
  }
  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) return `${path}: anyOf is not a list of schemas`;
    for (const [i, option] of schema.anyOf.entries()) {
      const defect = schemaDefect(option, `${path}.anyOf[${i}]`);
      if (defect) return defect;
    }
  }
  if (schema.properties !== undefined) {
    if (!isObject(schema.properties)) return `${path}: properties is not an object`;
    for (const [name, property] of Object.entries(schema.properties)) {
      if (name === "__proto__") return `${path}: property named __proto__`;
      const defect = schemaDefect(property, `${path}.${name}`);
      if (defect) return defect;
    }
  }
  if (schema.required !== undefined) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    if (!Array.isArray(schema.required)) return `${path}: required is not a list`;
    for (const name of schema.required) {
      if (typeof name !== "string" || !Object.hasOwn(properties, name)) return `${path}: required ${String(name)} is not a property`;
    }
  }
  if (schema.items !== undefined) {
    const defect = schemaDefect(schema.items, `${path}[]`);
    if (defect) return defect;
  }
  return null;
}

type Reading = { ok: true; value: unknown } | { ok: false; reason: string };

function fail(reason: string): Reading {
  return { ok: false, reason };
}

/** The name of a place in the arguments, for a refusal: `siren`, `criteres[0].valeur`, or `arguments` for the whole. */
function label(path: string): string {
  return path === "" ? "arguments" : path;
}

function readString(schema: Schema, value: string, path: string): Reading {
  if (isBound(schema.minLength) && value.length < (schema.minLength as number)) return fail(`${label(path)}: shorter than ${String(schema.minLength)} characters`);
  if (isBound(schema.maxLength) && value.length > (schema.maxLength as number)) return fail(`${label(path)}: longer than ${String(schema.maxLength)} characters`);
  if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value) && !new RegExp(schema.pattern, "i").test(value)) {
    return fail(`${label(path)}: does not match the expected pattern`);
  }
  if (schema.format === "uri") {
    const url = value.trim().replace(/[\t\n\r]/g, "");
    try {
      new URL(url);
    } catch {
      return fail(`${label(path)}: not a URL`);
    }
    return { ok: true, value: url };
  }
  return { ok: true, value };
}

function readNumber(schema: Schema, value: number, path: string, integer: boolean): Reading {
  if (Number.isNaN(value)) return fail(`${label(path)}: not a number`);
  if (integer && !Number.isInteger(value)) return fail(`${label(path)}: not an integer`);
  if (isBound(schema.minimum) && value < (schema.minimum as number)) return fail(`${label(path)}: below ${String(schema.minimum)}`);
  if (isBound(schema.maximum) && value > (schema.maximum as number)) return fail(`${label(path)}: above ${String(schema.maximum)}`);
  return { ok: true, value };
}

function readArray(schema: Schema, value: unknown[], path: string): Reading {
  if (isBound(schema.minItems) && value.length < (schema.minItems as number)) return fail(`${label(path)}: fewer than ${String(schema.minItems)} items`);
  if (isBound(schema.maxItems) && value.length > (schema.maxItems as number)) return fail(`${label(path)}: more than ${String(schema.maxItems)} items`);
  if (schema.items === undefined) return { ok: true, value: [...value] };
  const out: unknown[] = [];
  for (const [i, item] of value.entries()) {
    const r = read(schema.items as Schema, item, `${path}[${i}]`);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return { ok: true, value: out };
}

function readObject(schema: Schema, value: Record<string, unknown>, path: string): Reading {
  const properties = isObject(schema.properties) ? (schema.properties as Record<string, Schema>) : {};
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const out: Record<string, unknown> = {};
  // The schema's order, never the caller's: unknown keys are dropped.
  for (const [name, property] of Object.entries(properties)) {
    const at = path === "" ? name : `${path}.${name}`;
    const given = Object.hasOwn(value, name) ? value[name] : undefined;
    if (given === undefined) {
      if (Object.hasOwn(property, "default")) {
        const r = read(property, structuredClone(property.default), at);
        if (!r.ok) return r;
        out[name] = r.value;
      } else if (required.has(name)) {
        return fail(`${at}: required`);
      }
      continue;
    }
    const r = read(property, given, at);
    if (!r.ok) return r;
    out[name] = r.value;
  }
  return { ok: true, value: out };
}

function readTyped(schema: Schema, type: string, value: unknown, path: string): Reading | undefined {
  switch (type) {
    case "string":
      return typeof value === "string" ? readString(schema, value, path) : undefined;
    case "integer":
      return typeof value === "number" ? readNumber(schema, value, path, true) : undefined;
    case "number":
      return typeof value === "number" ? readNumber(schema, value, path, false) : undefined;
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : undefined;
    case "array":
      return Array.isArray(value) ? readArray(schema, value, path) : undefined;
    case "object":
      return isObject(value) ? readObject(schema, value, path) : undefined;
    default:
      return undefined;
  }
}

function read(schema: Schema, value: unknown, path: string): Reading {
  if (Array.isArray(schema.anyOf)) {
    // zod's union: the first option that accepts the value gives the output.
    for (const option of schema.anyOf as Schema[]) {
      const r = read(option, value, path);
      if (r.ok) return r;
    }
    return fail(`${label(path)}: matches none of the accepted forms`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((allowed) => allowed === value)) return fail(`${label(path)}: not one of the allowed values`);
  const types = typesOf(schema);
  if (types.length === 0) return { ok: true, value };
  let lastFailure: Reading | undefined;
  for (const type of types) {
    const r = readTyped(schema, type, value, path);
    if (r?.ok) return r;
    if (r) lastFailure = r;
  }
  return lastFailure ?? fail(`${label(path)}: expected ${types.join(" or ")}`);
}

/**
 * Reads the arguments of a call through the tool's input schema (an object schema with no defect, `schemaDefect`):
 * the arguments as the hosted server would see them, or the reason of a refusal.
 */
export function readArguments(schema: unknown, args: Record<string, unknown> | undefined): ArgumentsReading {
  const r = read(schema as Schema, args ?? {}, "");
  if (!r.ok) return r;
  return isObject(r.value) ? { ok: true, value: r.value } : { ok: false, reason: "arguments: not an object" };
}

/**
 * A canonical JSON text, to compare two tool definitions: object keys sorted, except the keys of a `properties` or a
 * `requete` object, whose order is part of the meaning (the query string of a call is written in that order, and the
 * quote is signed over the request); a `required` list sorted (its order means nothing). Other arrays keep their order.
 */

type Role = "ordered" | "required" | undefined;

function roleOf(key: string): Role {
  return key === "properties" || key === "requete" ? "ordered" : key === "required" ? "required" : undefined;
}

function canonicalValue(value: unknown, role: Role): unknown {
  if (Array.isArray(value)) {
    const items = value.map((v) => canonicalValue(v, undefined));
    return role === "required" ? [...items].sort((a, b) => String(a).localeCompare(String(b))) : items;
  }
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>);
  if (role === "ordered") return Object.fromEntries(entries.map(([k, v]) => [k, canonicalValue(v, undefined)]));
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(sorted.map(([k, v]) => [k, canonicalValue(v, roleOf(k))]));
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, undefined));
}

/**
 * An input schema without its `description` texts (a property named `description` stays) and without its `$schema`
 * dialect: what the arguments are read through. A parameter description, or the dialect the server's SDK writes, that
 * changes on the server does not change how a call is made.
 */
export function schemaShape(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(schemaShape);
  if (schema === null || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "description" || key === "$schema") continue;
    if (key === "properties" && value !== null && typeof value === "object" && !Array.isArray(value)) {
      out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, property]) => [name, schemaShape(property)]));
    } else if (key === "items" || key === "anyOf") {
      out[key] = schemaShape(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

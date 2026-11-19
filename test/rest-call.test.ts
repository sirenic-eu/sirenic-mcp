/**
 * The generic call (decision C): the request comes from the tool's call template and the arguments, read through the
 * schema; it goes to /v1 of the API with the template's Accept and the package's User-Agent, GET only, never following a
 * redirect; the answer comes back the way the hosted server renders it (JSON data or error with statut_http, PDF in
 * base64, Markdown as is). A refusal of the arguments is local: nothing is sent.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ERROR_TEXT_LIMIT } from "../src/rest.js";
import { USER_AGENT } from "../src/version.js";
import { SNAPSHOT, dataReply, errorReply, paymentResponseHeader } from "./helpers/fixtures.js";
import { localServer, resultOf } from "./helpers/local.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

const tool = (name: string): Tool => structuredClone(SNAPSHOT.tools.find((t) => t.name === name)!);
const textOf = (r: unknown): string => ((r as { content: Array<{ text: string }> }).content[0]!.text);

describe("C: each tool calls the REST API by its call template", () => {
  it("path argument, query parameters in the template's order, Accept and User-Agent; GET, redirects never followed", async () => {
    const t = await localServer({}, { onRequest: () => dataReply({ resultats: [] }) });
    close = t.close;
    await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    await t.client.callTool({ name: "search_french_companies", arguments: { q: "Société Générale & Cie" } });
    await t.client.callTool({ name: "get_french_company_intelligence", arguments: { siren: "552032534" } });
    expect(t.api.requests.map((q) => q.path)).toEqual([
      "/v1/entreprise/552032534",
      "/v1/recherche?q=Soci%C3%A9t%C3%A9+G%C3%A9n%C3%A9rale+%26+Cie",
      // the schema's default (vue: synthese) is sent, as the hosted server sends it
      "/v1/intelligence/552032534?vue=synthese",
    ]);
    for (const q of t.api.requests) {
      expect(q.method).toBe("GET");
      expect(q.redirect).toBe("manual");
      expect(q.headers.accept).toBe("application/json");
      expect(q.headers["user-agent"]).toBe(USER_AGENT);
      expect(q.headers["x-api-key"]).toBeUndefined();
      expect(q.headers["payment-signature"]).toBeUndefined();
    }
  });

  it("every encoding of the query: list joined by commas, JSON, a true flag sent and a false one omitted, an empty text omitted", async () => {
    const t = await localServer({}, { onRequest: () => dataReply() });
    close = t.close;
    await t.client.callTool({
      name: "query_french_companies",
      arguments: { mode: "lister", champs: ["identite.naf", "siege.region"], page: 2, criteres: [{ champ: "identite.naf", op: "=", valeur: "62.01Z" }] },
    });
    const sent = new URL(`https://x${t.api.requests[0]!.path}`);
    expect(sent.pathname).toBe("/v1/entreprises/requete/lister");
    expect([...sent.searchParams.keys()]).toEqual(["criteres", "page", "champs"]);
    expect(sent.searchParams.get("criteres")).toBe('[{"champ":"identite.naf","op":"=","valeur":"62.01Z"}]');
    expect(sent.searchParams.get("champs")).toBe("identite.naf,siege.region");
  });

  it("a JSON answer: the data as served, in structuredContent.resultat and as indented text", async () => {
    const body = { citation: "Sirenic", siren: "552032534", denomination: "DANONE" };
    const t = await localServer({}, { onRequest: () => dataReply(body) });
    close = t.close;
    const r = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(r.isError).toBe(false);
    expect(r.structuredContent).toEqual({ payment_required: false, resultat: body });
    expect(textOf(r)).toBe(JSON.stringify(body, null, 2));
    expect(r._meta?.["x402/payment-response"]).toBeUndefined();
  });

  it("an error of the API: as served, with statut_http, isError (a 503, a 401 for a refused key, a 402 without quote, a 429)", async () => {
    const answers = [
      errorReply(503, { error: "amont_indisponible", message: "Upstream register unavailable" }),
      errorReply(401, { error: "cle_invalide", message: "Invalid API key" }),
      errorReply(402, { error: "credits_insuffisants", message: "Insufficient balance" }),
      errorReply(429, { error: "trop_de_requetes", message: "Slow down" }),
    ];
    const t = await localServer({}, { onRequest: (_q, n) => answers[n - 1]! });
    close = t.close;
    for (const expected of answers) {
      const r = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
      expect(r.isError).toBe(true);
      const { status, json } = expected as { status: number; json: Record<string, unknown> };
      expect(resultOf(r)).toEqual({ statut_http: status, ...json });
      expect((r.structuredContent as { payment_required: boolean }).payment_required).toBe(false);
    }
  });

  it("m1: an error answer that is not JSON is cut beyond the limit, and the cut is said; a 2xx is never cut", async () => {
    const long = "x".repeat(ERROR_TEXT_LIMIT + 500);
    const answers = [
      { status: 502, text: `<html>${long}</html>`, contentType: "text/html" },
      { status: 200, text: long, contentType: "text/plain" },
    ];
    const t = await localServer({}, { onRequest: (_q, n) => answers[n - 1]! });
    close = t.close;
    const error = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(resultOf(error)).toMatchObject({ statut_http: 502, texte_tronque: true, longueur: long.length + 13 });
    expect((resultOf(error).texte as string).length).toBe(ERROR_TEXT_LIMIT);
    const ok = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(ok.isError).toBe(false);
    expect(resultOf(ok).texte).toBe(long);
    expect(resultOf(ok).texte_tronque).toBeUndefined();
  });

  it("a redirect is never followed: the 3xx comes back as an error, one request only", async () => {
    const t = await localServer({}, { onRequest: () => ({ status: 302, headers: { location: "https://example.org/v1/x" } }) });
    close = t.close;
    const r = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(r.isError).toBe(true);
    expect(resultOf(r).statut_http).toBe(302);
    expect(t.api.requests.length).toBe(1);
  });

  it("a PDF tool: Accept application/pdf, the PDF in base64 with its file name", async () => {
    const pdf = Buffer.from("%PDF-1.7\nfake pdf for the test\n%%EOF");
    const t = await localServer({}, { onRequest: () => ({ status: 200, bytes: pdf, contentType: "application/pdf", headers: { "content-disposition": 'attachment; filename="rapport-552032534.pdf"' } }) });
    close = t.close;
    const r = await t.client.callTool({ name: "get_french_company_pdf_report", arguments: { siren: "552032534" } });
    expect(t.api.requests[0]!.headers.accept).toBe("application/pdf");
    expect(r.isError).toBe(false);
    expect(JSON.parse(textOf(r))).toEqual({ filename: "rapport-552032534.pdf", content_type: "application/pdf", pdf_base64: pdf.toString("base64") });
  });

  it("a PDF tool answered in JSON (an error, or a filing served as JSON): rendered as a JSON tool", async () => {
    const t = await localServer({}, { onRequest: () => errorReply(404, { error: "introuvable", message: "No such company" }) });
    close = t.close;
    const r = await t.client.callTool({ name: "get_french_company_pdf_report", arguments: { siren: "552032534" } });
    expect(r.isError).toBe(true);
    expect(resultOf(r)).toEqual({ statut_http: 404, error: "introuvable", message: "No such company" });
  });

  it("the Markdown tool: Accept text/markdown, the text as served", async () => {
    const md = "# DANONE\n\nA briefing.\n";
    const t = await localServer({}, { onRequest: () => ({ status: 200, text: md, contentType: "text/markdown; charset=utf-8" }) });
    close = t.close;
    const r = await t.client.callTool({ name: "get_french_company_briefing", arguments: { siren: "552032534", langue: "en" } });
    expect(t.api.requests[0]!.path).toBe("/v1/entreprise/552032534/briefing?langue=en");
    expect(t.api.requests[0]!.headers.accept).toBe("text/markdown");
    expect(r).toMatchObject({ content: [{ type: "text", text: md }], isError: false });
  });

  it("the receipt is the API's: a PAYMENT-RESPONSE that says success reaches the client, one that says failure does not", async () => {
    const ok = { success: true, transaction: `0x${"ab".repeat(32)}`, network: "eip155:8453" };
    const answers = [dataReply(undefined, { "payment-response": paymentResponseHeader(ok) }), dataReply(undefined, { "payment-response": paymentResponseHeader({ success: false }) })];
    const t = await localServer({}, { onRequest: (_q, n) => answers[n - 1]! });
    close = t.close;
    const first = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(first._meta?.["x402/payment-response"]).toEqual(ok);
    const second = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(second._meta?.["x402/payment-response"]).toBeUndefined();
  });

  it("the API cannot be reached: service_injoignable, nothing signed", async () => {
    const t = await localServer({}, { onRequest: () => ({ networkError: "ECONNREFUSED" }) });
    close = t.close;
    const r = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: "552032534" } });
    expect(resultOf(r).error).toBe("service_injoignable");
    expect(resultOf(r).message).toContain("ECONNREFUSED");
  });
});

describe("refusals before any request", () => {
  it("arguments that do not fit the schema: argument_invalide, naming the argument, nothing sent", async () => {
    const t = await localServer({}, { onRequest: () => dataReply() });
    close = t.close;
    const missing = await t.client.callTool({ name: "get_french_company_profile", arguments: {} });
    expect(resultOf(missing)).toMatchObject({ error: "argument_invalide" });
    expect(resultOf(missing).message).toBe("Invalid arguments for tool get_french_company_profile: siren: required. Nothing was sent.");
    const wrongType = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: 552032534 } });
    expect(resultOf(wrongType).error).toBe("argument_invalide");
    expect(t.api.requests).toEqual([]);
  });

  it("a path argument of dots: argument_invalide in English, as the shared analyser decides, nothing sent", async () => {
    const lax = tool("get_french_company_profile");
    delete (lax.inputSchema.properties as Record<string, Record<string, unknown>>).siren!.pattern;
    delete (lax.inputSchema.properties as Record<string, Record<string, unknown>>).siren!.minLength;
    delete (lax.inputSchema.properties as Record<string, Record<string, unknown>>).siren!.maxLength;
    const t = await localServer({}, { onRequest: () => dataReply() }, { snapshot: { ...SNAPSHOT, tools: [lax] } });
    close = t.close;
    const r = await t.client.callTool({ name: "get_french_company_profile", arguments: { siren: ".." } });
    expect(resultOf(r)).toEqual({
      error: "argument_invalide",
      message: 'Invalid arguments for tool get_french_company_profile: path argument is empty, "." or "..": siren. Nothing was sent.',
    });
    expect(t.api.requests).toEqual([]);
  });

  it("m2: a template that gives no request for valid arguments is a fault of Sirenic: gabarit_invalide, nothing sent", async () => {
    // a list parameter typed as a string by the schema: valid for the schema, impossible for the template
    const odd = tool("compare_french_companies");
    const appel = odd._meta!["eu.sirenic/appel"] as { requete: Record<string, string> };
    const listParam = Object.entries(appel.requete).find(([, e]) => e === "virgules")![0];
    (odd.inputSchema.properties as Record<string, unknown>)[listParam] = { type: "string" };
    const t = await localServer({}, { onRequest: () => dataReply() }, { snapshot: { ...SNAPSHOT, tools: [odd] } });
    close = t.close;
    const r = await t.client.callTool({ name: "compare_french_companies", arguments: { [listParam]: "552032534" } });
    expect(resultOf(r).error).toBe("gabarit_invalide");
    expect(resultOf(r).message).toContain("a fault of Sirenic, not of the caller");
    expect(resultOf(r).message).toContain(`${listParam}: the value is not a list of strings`);
    expect(t.api.requests).toEqual([]);
  });

  it("an unknown tool: a protocol error, nothing sent", async () => {
    const t = await localServer({}, { onRequest: () => dataReply() });
    close = t.close;
    await expect(t.client.callTool({ name: "no_such_tool", arguments: {} })).rejects.toThrow(/Unknown tool/);
    expect(t.api.requests).toEqual([]);
  });
});

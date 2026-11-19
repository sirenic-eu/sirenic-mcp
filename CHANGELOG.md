# Changelog

## 0.2.0 (2026-11-19)

A local server whose tools are defined in this repository and call the Sirenic REST API themselves. 0.1.0 forwarded
every call to the hosted MCP server.

- The snapshot `catalogue/instantane.json` (119 tools, read from the Sirenic server 1.2.1 on 2026-11-19) is the source
  of the tools served: names, descriptions, input schemas and each tool's call template (`_meta["eu.sirenic/appel"]`).
  A tool that cannot be called the way the hosted server calls it (template out of the closed form, unknown schema
  keyword, schema and template that disagree) is excluded and named at startup.
- Each call reads its arguments through the tool's input schema (unknown keys dropped, keys in the schema's order,
  defaults applied, as the hosted server reads them), builds its request with the analyser the hosted server uses
  (`src/appel-outil.ts`, same test vectors on both sides) and sends a `GET` under `/v1/` of the API: `X-Api-Key` on
  the key rail, the signed quote in `PAYMENT-SIGNATURE` on the x402 rail. Redirects are never followed.
- Answers rendered as the hosted server renders them: JSON with `statut_http` on an error, PDF in base64, Markdown as
  is; an error answer that is not JSON is cut beyond 2000 characters and says so, a success never is.
- The hosted `tools/list`, read at startup when it answers, only refreshes the list (descriptions; a tool withdrawn or
  changed on the server is not served; a tool added there is named). Without it, the snapshot serves and the calls
  still go to the API.
- After a signed payment, an outcome that may have paid (a settlement the API could not confirm, an answer that is not
  the API's, a broken connection, a call cancelled while the payment travels) counts against the session cap as
  `reglement_incertain`; a refused settlement, a new quote or an error of the API give the reservation back. A call
  cancelled before the signed request is sent pays nothing (`appel_annule`).
- Errors of the package, a closed list: `argument_invalide`, `gabarit_invalide`, `plafond_depasse`, `paiement_refuse`,
  `reglement_incertain`, `appel_annule`, `service_injoignable`. `cle_invalide`, `compte_inactif` and
  `trop_de_requetes` are gone: the API's own 401, 403 and 429 reach the client as served.
- API: `startSirenicServer(config, api, extra)` takes a `SirenicApi` (the REST client) instead of a `RemoteServer`;
  `RemoteServer` only reads the hosted tool list, anonymously. New exports: `SirenicApi`, `catalogueFromSnapshot`,
  `refreshCatalogue`, `readArguments`, `KNOWN_KEYWORDS`.
- A daily workflow (`.github/workflows/derive-instantane.yml`) compares the snapshot with the server's free
  `tools/list` and opens one issue on any difference, so that a new snapshot is proposed.
- README rewritten: the tool definitions live here, each tool calls the REST API and pays; the free key figures are the
  API's; NAF 62.01Z is "computer programming".

## 0.1.0 (2026-10-09)

- Local MCP server (stdio) reflecting the tools of the Sirenic server (`tools/list` read at startup, payment
  arguments removed, `_meta` with each tool's routes and prices).
- Two rails: API key (`SIRENIC_API_KEY`, Bearer on `/mcp/connecteur`) and x402 (`SIRENIC_WALLET_KEY`, local
  signature), the key first.
- Caps per call and per session for x402 (`SIRENIC_MAX_PAR_APPEL`, `SIRENIC_MAX_PAR_SESSION`, $0.05 and $0.50 by
  default), refused quotes named with their price and the variable to raise. The session cap is reserved before any
  signature: calls sent together never spend more than it.
- Settlement receipt returned in `_meta["x402/payment-response"]`, as the server attaches it: never made up here.
- README tools table generated from the snapshot; a price that depends on a parameter (a watch's duration, a file's
  blocks) is shown from its base up to its maximum.
- Shipped snapshot of the tool list when the server cannot be reached at startup; calls refused, nothing signed.

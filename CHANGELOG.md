# Changelog

## 0.1.0 (unreleased)

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

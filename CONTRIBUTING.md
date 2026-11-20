# Contributing

Thank you for helping. Issues and pull requests are welcome, in English or in French.

## Set up

```bash
npm ci
npx tsc --noEmit     # typecheck
npm run build        # dist/
npm test             # vitest, without network
```

Node.js 22 (see `.node-version`). Try your build in an MCP client with `node dist/cli.js` as the command.

## Rules of this repository

- **Tests never open the network.** `test/setup-no-network.ts` refuses the global fetch, every TCP connection, every
  DNS query and every UDP socket; the Sirenic API is simulated by `test/helpers/fake-api.ts` (and its hosted tool list
  by `test/helpers/fake-remote.ts`), with answers recorded in `test/fixtures/`. A test that needs the real server does
  not belong here.
- **Tools, call templates and prices are never written by hand.** They come from the Sirenic server (`tools/list` and
  each tool's `_meta`: routes, prices, call template). To change a tool, its description, its call or its price, open an
  issue: it is a change on the server, and a new snapshot here.
- **The snapshot and the README table are generated.** `npm run instantane` rewrites `catalogue/instantane.json`
  from the server (anonymous and free); `npm run tableau` rewrites the tools table of the README from it. Never
  edit either by hand: `test/readme.test.ts` fails when they differ. The daily workflow `derive-instantane` opens an
  issue (label `instantane-derive`) when the server and the snapshot differ: answer it with a pull request that runs
  both scripts.
- **The call template analyser is shared.** `src/appel-outil.ts` and `test/fixtures/mcp-appel-vecteurs.json` are
  copied unchanged from the Sirenic server, which plays the same vectors: change them there first, then copy them here
  (`test/call-template.test.ts`).
- **No secret, no personal data.** Keys and wallets come from environment variables only, never from a file.
  Fixtures and examples use legal persons only (DANONE, SIREN 552032534, for instance). `gitleaks detect` runs in CI.
- **Nothing is written to disk** by the server, and there is one HTTP call for the tools, in `src/rest.ts`, whose
  paths come from the call templates only; the paywall is the API's: the package never builds a quote and only signs
  one the API returned, under the caps (`test/source.test.ts`).
- Dependencies are pinned to exact versions.

## Pull requests

One change per pull request, with its test. Describe what changes for the user of an MCP client. The CI runs the
typecheck, the build, the tests and the secret scan.

## Good first issues

Look for the `good first issue` label: small, self-contained changes with a clear test.

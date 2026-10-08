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
  DNS query and every UDP socket; the Sirenic server is simulated by `test/helpers/fake-remote.ts`, with the answers
  recorded in `test/fixtures/`. A test that needs the real server does not belong here.
- **Tools and prices are never written by hand.** They come from the Sirenic server (`tools/list` and each tool's
  `_meta`). To change a tool, its description or its price, open an issue: it is a change on the server.
- **The snapshot and the README table are generated.** `npm run instantane` rewrites `catalogue/instantane.json`
  from the server (anonymous and free); `npm run tableau` rewrites the tools table of the README from it. Never
  edit either by hand: `test/readme.test.ts` fails when they differ.
- **No secret, no personal data.** Keys and wallets come from environment variables only, never from a file.
  Fixtures and examples use legal persons only (DANONE, SIREN 552032534, for instance). `gitleaks detect` runs in CI.
- **Nothing is written to disk** by the server, and the package never calls a REST route itself: the paywall stays
  on the Sirenic server (`test/source.test.ts`).
- Dependencies are pinned to exact versions.

## Pull requests

One change per pull request, with its test. Describe what changes for the user of an MCP client. The CI runs the
typecheck, the build, the tests and the secret scan.

## Good first issues

Look for the `good first issue` label: small, self-contained changes with a clear test.

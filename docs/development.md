# Development and verification

Node.js 26+, npm 11.17+, Git and a native C/C++ toolchain are required.
Install dependencies at the repository root:

```sh
npm ci --ignore-scripts
npm rebuild better-sqlite3 --build-from-source
npm run typecheck
npm run build
npm test
npm run verify:architecture
npm run verify:container
```

The lockfile and npm policy enforce engine versions, dependency age and disabled
implicit installation scripts. SQLite is rebuilt explicitly. Root commands
coordinate all three services; do not add a global package pool.

## Test selection

Default tests include Codex only. Claude and Pi require `--all-runtimes`:
```sh
npm test -- --all-runtimes
npm run test:browser
node scripts/test.mjs crossfire non-browser
node scripts/test.mjs fleetd non-browser
node scripts/test.mjs fleet non-browser
```

The non-browser selection excludes browser files only; it still includes native
Codex, Conduit and integration checks. It is useful when deployment must finish
before browser verification. Run the full gates afterward.

Tests use isolated processes across all available CPU cores. Build/typecheck
and pinned stock Element extraction occur once per coordinated run. Timing logic
uses injected clocks. Native I/O waits for bounded observable conditions, not
fixed-duration sleeps. Logs, per-file timings and summaries are written under
`.temp/test-runs/`.

Default native tests require Codex 0.158.0+, Git, OpenSSH client/server, Chrome
and Docker. `CROSSFIRE_TEST_CODEX` selects Codex; `CROSSFIRE_BROWSER` selects
Chrome. Optional tests require Claude Code 2.1.285+ and Pi 0.99.1+.
Inert local providers establish protocol behavior, not paid-model quality or
untested-platform certification. Fixtures do not use production accounts.

## Ownership

Domain modules use ports and Result values, not transport or concrete adapters.
Composition roots wire functional adapters. Tinqer owns application queries;
raw SQL is reserved for schema and metadata. All product source and tests live
inside their owning service. Expected transaction failures roll back; native
operations stay outside database transactions.

Keep the specification, fixtures and generated release artifacts aligned.
Runtime settings are interpreted only by their runtime adapter. Preserve shared
work, credentials and production state. Deployment requires a verified backup
and forward migrations; no reset or schema-repair fallback exists.

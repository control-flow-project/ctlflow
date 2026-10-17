# Development and verification

Private work notes belong in ignored `.analysis/` directories. Never track,
force-add, commit or publish them at any depth. `npm run verify:structure`
checks the Git index and ignore coverage. Public verification reports belong
under `docs/verification/` after review, not in private working-note directories.

## Prerequisites

Use the repository's Node/npm engine requirements, lockfile, `global.json` and
`Directory.Packages.props` and `rust-toolchain.toml`. The integrated Linux gate requires rootless Docker,
Chrome, Git, OpenSSH, stock Codex and the native compilation dependencies for
.NET NativeAOT and Rust. The runner prepares checksum-pinned Conduit, Element and Pi assets.

`.npmrc` disables implicit install scripts and applies a seven-day release-age
policy. Only its explicit named exclusions apply. Do not disable that policy to
make installation pass. The pinned SQLite package has a usable native binary on
the verified Linux host. Explicit source compilation is needed only when the
selected platform lacks one.

```sh
systemd-run --user --scope --quiet \
  --property=MemoryMax=17179869184 --property=MemorySwapMax=0 \
  --property=TasksMax=2048 /bin/bash -c \
  'npm ci --ignore-scripts && npm run verify:parity -- /absolute/new-evidence-directory'
```

This example limits the aggregate process group to 16 GiB, zero swap and 2048
tasks, as required by Rust verification. The runner verifies cgroup v2
limits; a JavaScript heap limit is not a substitute.

Docker build and runtime children do not inherit the caller's cgroup. The root
container coordinator creates and verifies a temporary finite user slice, places
its Docker children in it and removes that test-owned slice afterward. It does
not modify a production daemon or install a persistent service.

## Commands

| Command | Scope |
| --- | --- |
| `npm run typecheck` | Node products and the shared React project |
| `npm run build` | Compiled packages, products, UI and local distributions |
| `npm test` | Build once, then all Node-owned tests and workspace checks |
| `npm run verify:architecture` | Ownership, imports, packages, installation and current documentation links |
| `npm run verify:csharp` | Managed and NativeAOT internal/native tests |
| `npm run test:rust` | Rust internal/native tests, generators and interchange proofs |
| `npm run publish:csharp -- --mode managed --output /absolute/new-distribution` | Self-contained managed products and shared assets |
| `npm run publish:csharp -- --mode nativeaot --output /absolute/new-distribution` | NativeAOT products and shared assets |
| `npm run publish:rust -- --output /absolute/new-distribution` | Native products, shared assets, pinned data and notices |
| `npm run verify:contracts -- /absolute/matrix.json` | Shared installed-product scenarios for every configured target |
| `npm run verify:container -- /absolute/matrix.json` | Actual operator, image, browser and persistent-container scenarios |
| `npm run verify:parity -- /absolute/new-evidence-directory` | Serialized integrated gate, including migration containers |

Do not precede `npm test` with another build. Do not run two build coordinators
against the same output directories. A failed configured target fails the gate;
it is not silently removed from the matrix.

For a local-impact change, select the affected tests. Cross-layer or uncertain
changes require the integrated gate.

```sh
node scripts/test.mjs crossfire non-browser
node scripts/test.mjs crossfire browser
node scripts/test.mjs fleetd non-browser
node scripts/test.mjs fleet non-browser
```

Run these inside the same verified resource scope. Non-browser still includes
native integration. Codex and Pi are required runtime coverage; there is no
optional runtime switch. `CROSSFIRE_TEST_CODEX` and `CROSSFIRE_BROWSER` select
their executables without changing assertions.

## Test ownership

External behavior belongs to each product's `tests/contracts/`. One executable
matrix selects Node, C# managed, C# NativeAOT and Rust distributions explicitly.
The complete integrated gate requires all four. Assertions do not branch by implementation.

Language-local tests cover internal algorithms, protocol state, storage and
compiler behavior. Shared scenarios exercise actual HTTP/Unix sockets, SQLite,
native engines, CLI, browsers and containers. Mocked failure injection is not
paid-provider or production certification.

Tests use private independent directories, databases, ports, native homes and
identities. Prepare immutable builds and pinned assets once before workers.
Dispose owned resources in reverse acquisition order. Timing logic uses injected
clocks; native I/O uses bounded observations, not fixed sleeps.

Results include per-file counts, failures, cancellation, duration and bounded
logs. An authentication-only route loop does not establish successful route
behavior. The common API bank separately records successful responses decoded by
the canonical output schemas and refuses untested operation declarations.

## Database and generated code

Knex creates all fixture schemas. Node queries through Tinqer, C# through EF and
Rust through Diesel. No runtime migrates at startup. Update database contracts, native models,
query generation and consumers together when changing storage.

```sh
node services/crossfire/scripts/generate-sqlite-model.mjs --check
node services/crossfire/scripts/generate-rest-catalog.mjs --check
node services/fleetd/scripts/generate-rest-catalog.mjs --check
```

Generated metadata is checked against its current owner. Never patch generated
EF query output to conceal a compiler defect. Build-only EF tooling must not
enter production distributions.

## Distribution

Only `@ctlflow/fleet` and `@ctlflow/fleetd` may be public npm packages.
All three product versions agree; public dependencies use exact pins.
Installation gates pack and install the actual archives outside the workspace,
check their file allowlists and verify private-module bundling.

Separate target guides document build-time and installed prerequisites, exact
entrypoints, sibling assets and upgrade procedures. Native distributions ship
the selected guide as their self-contained README; npm archives ship their
product documentation. Documentation checks validate current repository links
and reject promotional claims. Standalone-guide checks reject checkout-relative
links before packaging.

- [Installation and packaging for all four targets](distributions/README.md)

A successful local pack is not registry publication. A running fixture is not a
deployment. Production activation requires separate authorization, a verified
backup where data changes and successful migration before application startup.

## Cleanup

After verification no longer needs them, remove recreated fixture databases,
native test homes, build output and test caches. Keep concise logs and summaries.
Never remove active resources, other worktrees, credentials, production data,
research originals or saved user/native histories. Do not use global Docker
pruning as a project cleanup command.

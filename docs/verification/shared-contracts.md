# Shared executable contract tests

Each product owns external assertions under `tests/contracts/`.
The root coordinates builds, process limits and target selection.
Tests send the same requests and expect the same results for every target.

## Targets

The matrix is a schema-version-one JSON object containing explicit executable
and argument vectors for each server, daemon and CLI. Include the Node reference.
Selecting C# requires both `csharp-managed` and `csharp-nativeaot`.
The integrated gate also requires an explicit Rust distribution. A C#-only
build does not establish Rust readiness.

```sh
node scripts/publish-csharp.mjs --mode managed --output /absolute/managed
node scripts/publish-csharp.mjs --mode nativeaot --output /absolute/nativeaot
node scripts/publish-rust.mjs --output /absolute/rust
node scripts/contract-matrix.mjs --managed /absolute/managed \
  --nativeaot /absolute/nativeaot --rust /absolute/rust --output /absolute/matrix.json
npm run verify:contracts -- /absolute/matrix.json
npm run verify:container -- /absolute/matrix.json
```

Use new output paths and a verified finite resource scope.
Run these commands serially. Do not rebuild outputs used by live tests.
The combined command is:

```sh
npm run verify:parity -- /absolute/new-evidence-directory
```

It runs architecture, Node tests, C# tests, Rust tests, both C# distributions,
Rust publication, matrix generation, installed-product tests, container tests
and migration-container tests. Failure stops subsequent phases. Configured targets cannot be skipped.

## Coverage

| Area | Assertions |
| --- | --- |
| API authentication | Every protected canonical route rejects an unauthenticated request |
| Successful API behavior | Every declared REST operation has a successful response decoded by its canonical output schema |
| Input boundaries | Canonical pagination, duplicate/unknown fields, host, origin, CSRF and request bounds |
| Authorization | Owner/admin scope, native room authority, delegated invitations and recorded addition provenance |
| Coordination | Enrollment, controller leases, exact lifecycle claims/receipts, stop evidence and retirement |
| Decisions | Exact owner review/answer, generation-bound publication and no answer on GET |
| Scheduled input | Rule CRUD, due claim, eligibility and exact-session acknowledgment |
| Publications | Manifest/upload/commit, opaque-origin execution, inventory and deletion fence |
| UI | Durable management routes, wake selection, stale edits, room delegation, schedules, decisions, confirmations and reports at mobile/desktop widths |
| Native execution | Actual Codex/Pi chat, attribution, interruption, receipts, file-backed input, history and stop/resume |
| CLI/transport | Local daemon ownership, noninteractive setup, stopped intent, SSH host verification |
| Containers | Actual images/operators, Element room/media, same-file backend changes, concurrent starts and owned orphan recovery |
| Data | Knex initialization, historical conversion, rollback, unsupported-schema rejection and same-file access |

- [Scenario inventory](../../services/crossfire/tests/contracts/README.md)

An operation response check is not proof of every possible business-state
combination. Internal suites cover additional failure injection and state
transitions. Authentication-only coverage is never reported as successful
operation coverage. Fixture assertions do not certify paid providers.

## Operator recovery checks

A real launcher is killed while its runtime container remains running or exited.
The next selected implementation must remove that exact old ID and reopen the
same state. Running/exited migration-orphan fixtures exercise the same
reconciliation owner. A foreign migration label must refuse takeover without
stopping the correctly owned runtime. A second live launcher must fail without
touching the original stack.

Migration-orphan fixtures are controlled native containers representing abandoned
migration states; they are not a claim to simulate every possible power-loss
instruction boundary inside Knex or Docker.

## Evidence and disposal

The coordinator retains bounded logs and machine-readable results. Reports name
the exact source/distributions, runtimes, platform, test counts and failures.
NativeAOT diagnostics are retained separately from successful process results.

Tests own and dispose separate directories, SQLite/RocksDB stores, native homes,
browser contexts, sockets and exact container IDs. Inactive generated assets are
removed after their last use. No production state or shared image is a cleanup
target.

- [Resource limits and development commands](../development.md)
- [Current issue correction record](20261015-outside-review-fixes.md)

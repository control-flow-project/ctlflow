# Shared executable contract tests

Each product owns external assertions under `tests/contracts/`.
The root coordinates builds, process limits and target selection.
Tests send the same requests and expect the same results for every target.
These directories are ownership boundaries within one acceptance suite, not
separate Node, C# or Rust suites. Each selected executable set runs the same
server, fleetd, fleet, UI and ingress scenarios. Both controller and installed
CLI scenarios run with actual Codex and Pi processes and inert local providers.
Language-local compiler and algorithm tests supplement this bank; they cannot
replace it or establish another set of externally observable expectations.
The shared native question flow includes upstream reconnection, pending decisions
across delivery pause and new native questions while chat admission remains
paused. Answers must reach the exact original native tool request and history.
Read-only diagnostics must not start, resume, interrupt or answer native work.
Invitation cases verify owner-invited agents, same-owner/cross-owner collaborators,
native authority, explicit delegation and removal limited to one's own additions.

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
The runner rejects missing summary counters, skipped/unfinished scenarios and
different assertion counts between selected implementations, even when every
worker exits successfully.

Within the installed and container banks, targets run in independent test
processes concurrently up to the available CPU count in the verified aggregate
resource group. One shared matrix runner owns process groups, deadlines,
cancellation and complete per-target evidence. Synchronous native commands in
one target cannot block another target's browser or fixture heartbeat. Container
packages build once before those target fixtures start. Each target owns its
directory, ports, browser contexts and exact container identities; scenarios
within one fixture remain sequential. Concurrency does not change assertions,
product deadlines or the finite target/overall test timeouts.

The operator/package matrix is distributed across those workers: each selected
operator runs every backend package once. Four target workers therefore verify
all 16 ordered operator/implementation pairs, not 64 duplicate executions. Each worker
asserts its operator identity and records the implementation identities after successful
image, readiness and API checks. No unique pair or behavioral assertion is
omitted; each worker still runs the complete other container/recovery scenarios.

## Coverage

| Area | Assertions |
| --- | --- |
| API authentication | Every protected canonical route rejects an unauthenticated request |
| Successful API behavior | Every declared REST operation has a successful response decoded by its canonical output schema |
| Input boundaries | Canonical pagination, duplicate/unknown fields, host, origin, CSRF and request bounds |
| Authorization | Owner/admin scope, native room authority, delegated invitations and recorded addition provenance |
| Coordination | Enrollment, controller leases, exact lifecycle claims/receipts, stop evidence and retirement |
| Decisions | Actual Codex/Pi question through fleetd and crossfire to exact owner review/answer and original native tool output; generation-bound publication, no consent on GET or agent self-answer |
| Scheduled input | Rule CRUD, due claim, eligibility and exact-session acknowledgment |
| Publications | Manifest/upload/commit, opaque-origin execution, inventory and deletion fence |
| UI | Durable management routes, wake selection, stale edits, room delegation, schedules, decisions, confirmations and reports at mobile/desktop widths |
| Native execution | Actual Codex/Pi chat, attribution, interruption, receipts, file-backed input, history, stop/resume, idle/in-flight controller death and upstream outage recovery |
| Controller API | Every declaration has a decoded success or a checked native capability refusal; roster CRUD, revisions, operation replay, explicit updates and read-only readiness |
| CLI/transport | Both native engines; exact daemon ownership handoff, noninteractive setup, per-agent/fleet resume/reset/update, messages, delivery, restart and strict SSH host verification |
| CLI/controller interoperability | Every selected CLI reads every selected controller through the same private authenticated API; all 16 ordered four-target pairs run |
| Containers | Actual images/operators, Element room/media, same-file backend changes, concurrent starts and owned orphan recovery |
| Data | One current Knex initial schema, constraints, transaction rollback, verified backups and same-file access |

- [Scenario inventory](../../services/crossfire/tests/contracts/README.md)
- [Cross-runtime performance and offline reports](performance.md)
- [Messaging separation and diagnostics verification](20261019-messaging-separation-diagnostics.md)

An operation response check is not proof of every possible business-state
combination. Internal suites cover additional failure injection and state
transitions. Authentication-only coverage is never reported as successful
operation coverage. Fixture assertions do not certify paid providers.
Pi deliberately has no live terminal attachment. Every implementation must
return the same explicit unavailable result, without creating another writer;
that capability refusal is recorded separately from successful operations.
There are no implementation-specific test omissions or relaxed assertions.

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

The combined coordinator uses short private `/var/tmp/cf-` directories so Unix
socket paths do not grow with the checkout path. This also avoids the local
inode-constrained `/tmp` tmpfs. Keep adequate free bytes and inodes on the fixture
filesystem; a failed resource allocation is a failed gate, not a passing retry.

- [Resource limits and development commands](../development.md)
- [Current issue correction record](20261015-outside-review-fixes.md)

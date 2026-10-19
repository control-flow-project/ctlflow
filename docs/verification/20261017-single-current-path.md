# Single current-path review — 2026-10-17

Historical verification of the 2026-10-17 source, not the current architecture.
The current architecture removes the context/observation converters and historical
state admission described here. See `../architecture/messaging-backends.md`.

## Scope

Reviewed crossfire, fleetd and fleet across Node, C# and Rust: transport routing,
contracts, configuration, SQLite ownership, private runtime state, native adapter
selection, lifecycle recovery, release packaging and deployment selection.
The shared UI and database migrations remain shared assets, not target-specific
alternatives. Keyword searches supplement source and caller review; they are
not behavioral proof by themselves.

## Removed runtime preservation paths

| Finding | Correction |
| --- | --- |
| Normal enrollment/start relocated display-name profiles and listener state to instance-key locations | Removed the Node/C# converters and callers. All targets address profiles/state only by immutable instance key. |
| Opening controller storage imported `operations.json` into current UUID files | Removed the Node/C# importers. All targets reject the obsolete file without reading, converting or deleting it. |
| Controller startup/maintenance converted untimestamped `daemon.log` into timestamped partitions | Removed the converters/callers in all targets and the converted-partition filename form. All targets reject the obsolete root log; current diagnostics use daily partitions. |

There is no compatibility flag, retry through an older parser, alternate writer
or old-format runtime reader for these cases. Operators must resolve unsupported
state offline after a verified backup. Existing state does not authorize a second
runtime path. The obsolete profile/import/conversion tests were removed; current
retention, restart and safety assertions remain.

## Reviewed boundaries

- Management runtime opens only schema 17 with its exact Knex history. Knex
  alone performs the verified one-time forward migration before writers start.
  Backup inspection of a prior schema is not a runtime query path.
- Codex reads the canonical context registry and rejects obsolete files or an
  unfinished conversion marker. Explicit offline `--migrate-contexts` ends at
  that registry; ordinary resume does not invoke it. Pi validates its current
  registry and native history identity. Neither substitutes fresh history for
  a failed resume.
- Native publication and observation readers validate their current contract;
  old observation conversion is an explicit offline operator tool, not a listener
  reader or automatic recovery branch.
- Exact current REST/native interception routes are enforced; removed registration
  and profile route forms are rejected. Matrix's current `fallback/web` route is
  the protocol's authentication-page name, not an older implementation.
- Codex and Pi are explicit adapters for different engines, not substitutes.
  Unimplemented Claude and unavailable native model/effort combinations fail.
- Node, managed C#, NativeAOT C# and Rust are explicit package selections. A
  selected executable/container does not launch a different implementation after
  failure. Their REST contracts, UI assets and SQLite schema remain common.
- npm setup continues to install Node fleet/fleetd independently of the server
  target. The shared Knex container is a one-shot migration owner, not a Node
  server fallback for NativeAOT.

## Verification

Focused current-storage/logging tests pass 10/10. Native-history, offline
observation-conversion and source-map checks pass 12/12. Shared executable
contracts now assert that obsolete controller files block startup, retain exact
input bytes and publish neither a ready socket nor imported operation storage
for every selected target.

The initial integrated checkpoint passes 943 Node tests in 210 isolated files,
architecture checks, managed/NativeAOT C# core and native-runtime banks, and
271 Rust tests in 137 isolated binaries. Those counts identify that checkpoint,
not an assertion that later source was tested by an earlier run. Actual Codex
and Pi participate; fixtures do not call paid model providers.

The optional Docker assets add four focused canonical Node tests, which pass
after parent integration. Parent review removed shared server/fleet networking
and supplied the explicit Compose command required by its entrypoint override.
The initial container matrix passes the same 32 checks on each of Node, managed
C#, NativeAOT C# and Rust: 128 checks, zero failures or cancellations. Every
installed operator runs every backend package against the same retained state.
Checks include corrupt archives, incorrect labels, concurrent owners, killed
launchers and abandoned runtime/migration containers. Target durations are
332–364 seconds with four workers under a finite 16-GiB, zero-swap, 8192-task
aggregate budget.

Two test-fixture defects were corrected without changing runtime checks:
negative cases now copy rather than hard-link a shared archive, because link
changes invalidate the producer's inode metadata; large archives use disk-backed
project temporary directories rather than accumulating on RAM-backed `/tmp`.
Each negative-case copy is removed immediately. Earlier failed runs are not
counted as passing evidence.

The actual shared Knex container passes empty, schema-13 and schema-17 cases and
rejects future schema 18 without modifying it. The migration gate uses the
canonical producer's image labels rather than replacing the selected tag with an
unlabelled image. Both selectable C# distributions and actual Codex/Pi adapters
remain covered by their runtime banks; no paid-provider quality claim follows.

The final optional local stack passes 7/7 browser/container checks, including
owner-reviewed enrollment, separate native histories, public-port-only network
access, actual agent HTML publication, browser credential isolation and exact
identity/history/stop-state preservation after recreation. The final standalone
fleet image passes 4/4 checks, including actual offline Pi RPC. Strict types,
architecture (33/33) and the four focused Docker-source checks pass after parent
integration. These are Linux/amd64 results, not macOS/ARM certification.

## Portable package correction and final artifact checks

An actual containerd-backed deployment exposed a package identity defect before
any writers were stopped: a Docker classic image ID is its configuration digest,
whereas the containerd store exposes its root descriptor as the native image ID.
The old manifest represented both as one field. Package schema 2 replaces that
model with named transport references and separate exact configuration and root
descriptor digests. Node, C# and Rust validate the selected Docker adapter's
native identity and return its immutable execution handle. Malformed descriptors
do not retry the other representation. Schema 1 is rejected.

Commit `0c9da35a` produced the final runtime images, source fingerprint
`c003f4afda1fa9b81a1dc62a07d0feb127456706dfbb1c7f0d2ec32bea6b9a7c`.
Subsequent corrections affect verification fixtures, operator checks and test
resource containment, not these server or fleet runtime bytes.

| Final artifact check | Result |
| --- | --- |
| Current-source Node bank after operator/resource corrections | 952 tests in 211 files pass; 24 workers, 90.9 seconds after the shared build |
| Current strict types and architecture | Typecheck passes; 33 architecture checks pass |
| Node package producer, native image selection and concurrent port leases | 10 focused checks pass |
| Rust portable package tests | 4 pass |
| Managed and actual NativeAOT C# core | 5,246 assertions per target pass |
| Shared installed-executable bank | 69 per target; 276 pass |
| Docker classic shared container bank | 32 per target; 128 pass |
| Docker containerd shared container bank | 32 per target; 128 pass |
| Common slim Knex image | Empty, schema 13 and schema 17 pass; future schema 18 rejected unchanged |
| Optional local server stack and standalone fleet image | 7 plus 4 actual container/browser checks pass |

The C# check also verifies 2,072 calendar cases per target, six direct SQLite
interchange directions, 16 forward-migration/rollback cases and actual Conduit
authority. NativeAOT reports dynamic code and reflection JSON disabled. Compiler
diagnostics remain visible; this does not certify arbitrary reflection or every
upstream EF feature.

The final executable bank uses complete installed distributions, including native
SQLite, packaged history guards and pinned Codex/Pi assets. It reports zero failed
or cancelled checks. The second container bank uses a separate containerd-backed
engine, rather than assuming the classic-engine result applies to both stores.
All run under verified finite aggregate memory, swap and task budgets.

The final fixtures reserve concurrent Docker ports until disposal and renew their
actual controller leases during browser observations. They do not relax protocol
leases, assertion deadlines or native receipt checks. Earlier runs with incomplete
installed layouts, missing environment settings or expired fixture leases are
retained as failed attempts, not passing results.

The postmigration preservation operator now applies its explicit retention cutoff
to every audit comparison, including the retired-name audit check. Its five tests
retain cutoff equality and reject missing retained rows or mutations. This is an
operator-check correction, not permission to discard production authority data.

Desktop Chrome was observed moving into an unbounded D-Bus application scope.
The shared test resource guard now disables that registration in its child
environment. Seven focused runner/resource checks pass, including real browser,
renderer and service-process cgroup identity. No host D-Bus configuration changes.

## Publication and limits

Public npm fleet/fleetd 0.1.21 were published and their registry SHA-512 integrity
values match the verified local tarballs. All 120 external npm lock records are
unchanged. Other workspaces remain private. GHCR publication requires a separate
package-write credential and is not claimed by this report.

Passing checks do not establish an absolute proof against every possible
undiscovered defect.

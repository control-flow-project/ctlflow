# Single current-path review — 2026-10-17

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

Current runtime verification passes the 943-test Node bank, architecture checks,
managed/NativeAOT C# core and native-runtime banks, and 271 Rust tests in 137
isolated binaries. The same 69 executable contract checks pass on each of Node,
C# managed, C# NativeAOT and Rust, including obsolete-state rejection. Actual
Codex and Pi participate; fixtures do not call paid model providers.

The optional Docker assets add four focused canonical Node tests, which pass
after parent integration. Parent review removed shared server/fleet networking
and supplied the explicit Compose command required by its entrypoint override.
The final container matrix passes the same 32 checks on each of Node, managed
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

Public npm fleet/fleetd 0.1.21 were published and their registry SHA-512 integrity
values match the verified local tarballs. All 120 external npm lock records are
unchanged. Other workspaces remain private. GHCR publication requires a separate
package-write credential and is not claimed by this report.

Passing checks do not establish an absolute proof against every possible
undiscovered defect.

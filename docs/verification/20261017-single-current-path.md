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
Actual full-container/migration/local-stack acceptance and registry publication
remain pending. Passing checks do not establish an absolute proof against every
possible undiscovered defect.

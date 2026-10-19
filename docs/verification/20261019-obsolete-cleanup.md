# Obsolete-material cleanup review

Scope: local ctlflow source, generated mappings, fixtures, packaging and current
documentation. Node, managed C#, NativeAOT C# and Rust retain one current contract.
No deployment, publication, database reset, GAAP, Bad Bets or Turbine access is
part of this work.

Reviewed revision: `9d4ccdc1` plus the accompanying cleanup changes on
`feat/backend-separation-diagnostics-20261019`. Results below apply to those local
sources, not to the base revision alone or a deployed release.

## Removed material

| Finding | Owning correction |
| --- | --- |
| Six enrollment archive tables had no current writer; only a deleted historical migration populated them | Removed their schema parts, six guards, five indexes, EF/Diesel/Node mappings, retention queries, operator counts and synthetic archive fixtures |
| Stored listener runs permitted a missing controller despite mandatory fleet-controlled creation | Required fleet/connection/credential fields in the schema and all three domain/storage/wire implementations; removed null-controller branches and the Rust nullable-tuple decoder |
| Installed release was nullable despite every current heartbeat supplying it | Required a 1–200-character release, aligned all implementations and removed the UI's missing-release path |
| Operator enrollment plans allowed null fleet, controller and policy fields that the canonical contract requires | Required all three, removed the null-policy branch and added boundary regressions; roster comparison uses named objects |
| Two index pairs had identical definitions | Retained one credential composite-key index and one invitation-expiry index; removed their exact duplicates |
| Two test filenames described migrations while testing the current schema | Renamed them to current policy/runtime schema tests; retained their current constraint assertions |
| Current guides described nonexistent conversions, obsolete-file startup checks and archive retention | Removed those claims and corrected storage/retention links |
| Superseded design documents contradicted the current runtime contract | Removed both documents and their documentation-verifier exclusions; the specification remains the current owner |
| A current file-audit guide duplicated stale source counts and a past Rust review appeared under current architecture | Used the executable inventory for current counts; moved the dated review under verification and updated every consumer |

The current initial Knex schema contains 57 application tables, 101 foreign-key
relations, 87 explicit indexes and 20 triggers. Knex bookkeeping and SQLite's
automatic indexes are excluded. No importer, converter, old/new handler or
automatic reset was added.

## Review coverage

Reviewed the current schema and all language mappings; REST/domain/UI owners;
fleet/daemon registry, authentication, setup and operation formats; Codex/Pi
history, process, input/receipt and reset owners; package exports and executable
entrypoints; Docker/onboarding; generators, fixtures and current documentation.
The TypeScript import inventory covered 837 TS/TSX files. Its two apparent
unreferenced package modules are executable entrypoints used by packaging or
process spawning, not orphaned implementations. The native ownership inventory
and architecture gates supplement this inspection.

Legitimate saved native histories, explicit reset archives, audit attribution,
current expired/stopped state and dated verification evidence remain. Matrix's
native `fallback/web` registration endpoint and denied deprecated routes belong
to its protocol adapter; they are not alternate application implementations.
Defaults, cancellation of superseded work and malformed-current-input tests are
not historical-format support.

New regressions verify mandatory listener fields, immutable controller binding,
bounded release, no duplicate indexes, current enrollment preservation and
stopped-run attribution after its current connection disappears. The shared
executable bank checks that stopped-run release/controller attribution survives
switching the same SQLite file between every selected implementation.

## Verification

All required local gates passed on 2026-10-19. No test, timeout or assertion was
waived. Native fixtures use both Codex and Pi; messaging integration uses isolated
Conduit, not a deployed instance.

| Gate | Accepted result |
| --- | --- |
| Node typecheck, build and full tests | 978 tests in 214 files; includes real browser and native fleet integration; no failures, cancellations, skips or TODOs |
| Architecture | 33 tests; service ownership, generated mappings, native inventory, package boundaries and documentation pass |
| Managed and NativeAOT C# | Each: 5,300 core assertions, 98 authentication-storage assertions, 85 controller assertions, 584 runtime assertions, 498 actual messaging-authority assertions and 2,072 calendar cases |
| C# SQLite integration | Same-file Node/managed/NativeAOT interchange, cross-process ownership, current constraints, validation and backups pass |
| Rust | Formatting, warnings-as-errors lint, build and 290 tests in 141 binaries pass; includes actual Conduit integration |
| Distribution builds | Managed, NativeAOT and Rust packages for all three products pass; Node packages are built by the full Node gate |
| Shared executable contracts | Identical 115 tests pass on each of Node, managed C#, NativeAOT C# and Rust; no omissions, skips or cancellations |
| Actual container packages | Identical 34 tests pass on each target, including all 16 ordered CLI/package combinations and host-fleet attachment |
| Knex migration container | Initializes the current schema and repeats without changes; both operations pass |
| Performance | 96 measurements, 24 comparisons, zero request failures; every comparison passes its recorded limit |

The performance report was generated at `2026-10-19T14:17:33.255Z`. The sole
previously approved exception applies to managed C# saved-runtime observations:
median latency is 1.0650 times Node, p95 is 1.0170 times Node and throughput is
0.9835 times Node. Its limits remain 1.30, 1.30 and 0.95 respectively. All other
target/workload comparisons retain strict Node limits. No new tolerance was added.

Build/test coordinators ran in bounded process groups: 16 GiB memory, no swap,
and at most 8,192 tasks; Rust's internal suite used its tighter 2,048-task bound.
Isolated file/binary workers used the 24 available cores. Concise command logs,
per-file results and JSON/HTML performance reports remain local; rebuildable
fixtures and distribution output are not release evidence.

### Earlier unsuccessful attempts

- A fresh test Docker daemon lacked its pinned messaging images; verification
  stopped before discovery. Installing those exact isolated prerequisites fixed
  that setup failure without changing the normal Docker daemon.
- One full Node attempt cancelled native fleet integration at the unchanged
  180-second deadline. It reported no failed assertion or application error, so
  the cause is not established. Added phase diagnostics, not a speculative runtime
  fix. The correctly invoked focused run passed in 81.847 seconds; subsequent
  full runs passed, including the accepted final run at 81.34 seconds. A separate
  manual invocation used the wrong working directory and failed asset lookup;
  correcting that invocation resolved it.
- The complete native builds found a stale C# fixture expecting the removed
  schema-object counts and a Rust fixture treating a required controller as
  optional. Both fixtures now assert the current model; final gates pass.

### Disposition

No remaining confirmed obsolete implementation, compatibility reader/writer,
historical-schema admission, orphaned package module or superseded current guide
was found after the corrections. This is a source review and executable local
verification, not a proof against every possible defect or certification of
untested hosts. .NET 11 RC2/EF NativeAOT diagnostics remain visible and were not
suppressed; the supported query paths pass the actual NativeAOT gates.

Credentials, native user histories and running deployments were not changed.
These cleanup changes are prepared for source review; they are not a deployed
release.

## Artifact cleanup

Removed the task's test databases, native fixture homes, installed-package
fixtures, generated Node/UI output, C# `bin`/`obj` directories and Rust build
output after verification. Pruned images/build cache only from the dedicated
test Docker daemon, then stopped that daemon and removed its data. No active
container or volume remained before shutdown. Available `/home` space increased
from approximately 104 GiB to 128 GiB. Concise local evidence totals 6.6 MiB;
source, dependencies, credentials and saved user histories remain intact.

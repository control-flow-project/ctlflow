# Node/C# implementation readiness

Review date: 15 October 2026. Version: `0.1.20`.
Source: `feat/node-csharp-symmetry-20261015`, based on merged PR #51,
`9b8ce881d5f77d93eeb7f0bc2344a79ac226ffcd`.

Status: **All nine integrated verification phases pass for Node, managed C# and
actual NativeAOT on Linux x64. The supported product paths are signed off within
the platform/provider scope and explicit preview-framework risks below.**

Production, credentials, saved native histories and fleet selections are unchanged.
Rust is a separate worktree/PR, not an implementation certified by this report.
The subsequent Rust integration and four-target evidence belong to
[the Rust review](rust-review.md); this report retains the merged Node/C#
baseline and its explicit NativeAOT diagnostic disposition.

## One architecture

```text
services/
  crossfire/
    node/{apps/server,packages,tests,scripts,tools,Dockerfile}
    csharp/{apps/Crossfire.Server,packages,tests,build,scripts,Dockerfile}
    apps/web/                         one shared React application
    database/management/sqlite/        one Knex schema/migration owner
    knexfile.management.mjs
    tests/contracts/                  one external assertion bank
    scripts/                          shared schema/protocol generators
    docs/
  fleetd/
    node/{apps/daemon,packages,tests,scripts,tools}
    csharp/{apps/Fleetd.Daemon,packages,tests}
    tests/contracts/
  fleet/
    node/{apps/cli,packages,tests,scripts}
    csharp/{apps/Fleet.Cli,packages}
    tests/contracts/
scripts/                              workspace/build/verification only
```

The tree describes real owners, not required empty directories. No old service-level
backend application, package pool or alternate path remains. Architecture checks
reject removed layouts, reversed domain dependencies, application-source
reach-through and runtime dependencies on build/test projects. C# has 29 owned
projects. Public Node packages retain service-root manifests and `dist/`
distribution layout; their implementation source now lives under `node/`.

| Responsibility | Common rule | Necessary language difference |
|---|---|---|
| Domain | Functional modules, immutable values, typed ports and expected failures | TypeScript modules / C# static modules and records |
| Composition | One server, daemon and CLI in each selected implementation | npm exports / .NET project references |
| Persistence | Same SQLite file, tables, rows and constraints | Node Tinqer / C# EF Core |
| Migrations | Knex alone, in the same one-shot upgrade container | Neither backend creates or migrates schemas at startup |
| Browser | One React project and identical built assets | No backend-specific UI or frontend API variant |
| Native engines | fleetd owns lifecycle through Codex/Pi ports | Process, HTTP and filesystem libraries follow their platform |
| Coordination | Same REST and private daemon contracts | `adapter-crossfire` / `Crossfire.AdapterCrossfire` |
| Native execution composition | Enrollment, runtime lifecycle, failure reporting, stop receipts and resets belong to fleetd's execution adapter, not its daemon application | `adapter-execution` / `Fleetd.AdapterExecution` |
| Build | Service ownership and production dependency separation | .NET compiled-model/query generation has build-only owners |
| Distribution | Standalone products with exact shared tools and licensing | Node npm archives / managed self-contained and NativeAOT trees |
| Verification | Identical external expected values and assertions | Internal compiler/EF/protocol tests remain language-owned |

The selected backend never invokes another backend as a fallback. The shared
JavaScript agent IPC tool and Pi extension are intentional common assets, not
another server/controller implementation. C# runtime images need no Node backend.
The explicitly approved Knex migration container remains Node-based for every
implementation. Claude stays unimplemented.

Package boundaries also match semantically: the layout gate checks 19 Node/C#
package pairs, not just similarly named language directories. C#'s HTTP transport
project corresponds to the browser-safe Node client. Its process/TOML projects
isolate .NET-specific native transport and parsing; Node uses its standard-library
process APIs and the pinned TOML library inside their concrete adapter owners.
Shared agent-tool/Pi JavaScript assets and operator/test tooling have one owner,
not redundant C# copies. The daemon apps retain only API/host composition and the
explicit controller context-migration command in both languages.

## Corrections from integrated verification

- One web build owner prepares assets and compiled helper exports. Backend/release
  builds consume them rather than rebuilding/deleting an active shared UI tree.
- C# HTTP transport omits bearer credentials on public operations, sends no GET
  body and serializes `{}` for bodyless JSON POST operations. Owner-DM, typing
  and recovery requests are corrected at their transport owner.
- Both implementations inspect unstarted contexts without creating work areas.
  Dangling links, foreign ownership and shared-writable ancestors fail closed.
- Both listeners fence actual native publication during unread queries, not idle
  watch metadata or read-only acquisition. Cursor identity is semantic and checked
  again before committing asynchronous query results.
- Pausing releases only ordinary publication plans whose native sends have never
  been attempted, including empty plans. Matrix messages remain unread; attempted,
  uncertain and delivered native evidence cannot be discarded. Both languages
  cover these transitions without weakening checkpoint or stop-receipt guards.
- C# reporting distinguishes delivery-generation cancellation from real transport
  failure, matching Node. Deterministic barriers cover registration cancellation,
  old-run cleanup, rapid pause/resume, reuse, exact disposal counts and actual
  failure. Native close uses the final authenticated activity; controller-generation
  and stop-receipt guards remain intact.
- Installed managed controllers receive independent standard streams before
  background startup. CLI completion no longer waits on inherited controller pipes.
  Published executables have explicit owner-safe executable permissions.
- Node runtime staging includes its declared compiled first-party dependency
  closure, not tests, TypeScript source, unrelated products or C# source. C#
  publication excludes EF design/compiler/MSBuild tooling.
- Container assertions have one language-independent owner. The selected real
  operator, rootless image, Knex migration, Element and persistent restart run
  instead of a simulated container or substitute backend.
- The common coordinator runs Element's first-run public-room scenario before
  API cases seed rooms, with an explicit empty-room precondition. Every target
  retains the same room creation, attachment download and persistence assertions.
- Node and C# container-command owners create, attach, stop and remove by exact
  identity. Docker automatic removal no longer races explicit operator cleanup.
  Client process groups are isolated, cancellation also covers build/migration,
  and the unchanged shared fixture still signals the whole foreground group.
- EF's build-only compiler/host use the selected SDK's proper restore-then-build
  invocation. Calling `Restore;Build` inside one already evaluated project lost
  NuGet-generated build-host content on a genuinely cold build; warm local output
  had hidden it. Actual cold container publication verifies the owning fix.
- Container timezone data is compiled from the checksum-pinned IANA `2026c`
  archive and must match Node's pinned ICU release, including historical aliases.
  A moving Alpine package cannot silently change C# calendar behavior. Shared
  process observations distinguish signal termination from a running child.

## Verification evidence

Run `npm run verify:parity -- /absolute/new-evidence-directory` inside the finite
Linux scope in [shared contracts](../verification/shared-contracts.md). It
serializes builds and gates: never rebuild a worktree while tests still consume
its `dist/`, package or native output.

| Gate | Current result |
|---|---|
| Architecture | 33 architecture assertions, 8 layout/negative fixtures, 19 semantic package pairs and 29 C# projects pass |
| Full Node bank | 878 tests, 191 files, 24 isolated workers; zero failed/cancelled/skipped |
| Managed solution | Zero compiler warnings/errors |
| C# controller ownership | 28 assertions in managed and NativeAOT |
| C# SQLite/domain/HTTP core | 779 assertions in each mode |
| C# actual Conduit authority | 490 assertions in each mode |
| C# actual Codex/Pi and protocol acceptance | 517 assertions in each mode |
| Calendar parity | 2,072 comparisons in each mode |
| Same-file SQLite and cross-process locking | All six Node/managed/AOT directions; forced-exit lock recovery |
| Historical data | Schema 13/14/15/16 to 17; 16 schema-13/14/rollback/unsupported-version cases |
| Standalone C# products | Server, daemon and CLI built in managed and NativeAOT modes |
| Shared installed-product matrix | All 40 tests pass on each of Node, managed C# and NativeAOT |
| Real container matrix | All 46 tests pass, including Element, media, React, exact container cleanup and cross-backend restarts; zero failed/cancelled/skipped |
| Actual Knex migration container | Empty/schema-13/current stores advance successfully; future schema 18 is rejected without changing data |

The complete serialized command exits successfully. Its nine phases are
architecture, full Node, C# internal/native, managed publication, NativeAOT
publication, strict matrix generation, shared installed-product contracts,
real container contracts and actual Knex migration-container verification.
The local evidence directory is `/tmp/crossfire-parity-completion-20261015`;
its summary records every phase, duration, exit result and bounded log.

The shared scenarios cover every protected canonical route's authentication,
strict envelopes, signup/origin/CSRF, host-only cookies, exact name collisions,
owner/room isolation, decisions, controller/native-close receipts, static report
upload/deletion and an actual browser's opaque-origin sandbox. They also run
actual Codex/Pi chat, source attribution, immediate mention interruption of held
native work, owner-DM receipt/acceptance, large-message files, room/global/unread
queries, exact-history stop/restart/resume, CLI/SSH trust and mobile/desktop React.
Each backend reopens the identical SQLite file without import/export or reset.

The schema remains application ID `1129465426`, version 17: 63 application tables,
111 mapped foreign keys, 93 explicit indexes and 26 triggers. Generated model and
REST catalogs are checked for drift. All 120 external npm dependency records are
byte-for-byte unchanged from main; NuGet pins are unchanged.

The shared executable run also records 100 sequential authenticated SQLite policy
reads after 10 warmups, including loopback TLS and its proxy: Node p50/p95
6.25/7.93 ms, managed C# 17.67/24.79 ms and NativeAOT 16.55/21.72 ms. These are
observations from concurrent functional-test targets, not an isolated throughput
benchmark, a latency SLA or a claim that EF/NativeAOT universally beats Tinqer.
Calendar execution covers the same 2,072 cases in 117 ms managed and 39 ms AOT
on this host; those timings likewise do not replace correctness assertions.

## NativeAOT diagnostic audit

The SDK is pinned to `11.0.100-rc.1.26425.128`; EF/SQLite packages to
`11.0.0-rc.1.26425.128`. These remain preview dependencies. The owner approved both
outputs, with initial managed deployment permitted after verification. Build
selection is explicit; no executable falls back to managed or Node execution.

The NativeAOT server publication emits 1,007 visible IL diagnostics in this run. They are not
suppressed or converted into a warning-free claim. Counts describe emitted
diagnostics, not independent defects or stable totals across incremental builds.
The separate runtime-adapter NativeAOT publication is clean.

| Diagnostic family | Reviewed owner and disposition |
|---|---|
| IL2026 | Annotated EF DbContext/query entrypoints, including owned query call sites. Generated model and query interceptors execute in actual AOT CRUD, joins, retention, HTTP and Matrix tests. This is execution evidence, not a claim that arbitrary EF queries are trim-safe. |
| IL3050, IL3051 | EF/BCL dynamic generic, expression and provider paths. Native tests disable dynamic code and reflection JSON. The product exposes fixed owned queries, not arbitrary LINQ/models/plugins; no managed fallback exists. |
| IL2046, IL2092, IL2093 | Retained EF implementation/interface annotation mismatches. Pins remain explicit; supported-path tests do not certify unused provider APIs. |
| IL2055, IL2060, IL2062, IL2067, IL2069, IL2070/71/72/74/75/76, IL2081/87, IL2090/91, IL2111 | Generic reflection/metadata annotations in EF/BCL dependencies. All 63 entities and actual relationships have generated metadata. Changed queries/models require native verification again; these diagnostics are not blanket waivers for new code. |
| IL3002 | EF Spatialite assembly-file discovery. The application schema has no Spatialite feature, dynamic-extension API or assembly-location dependency. The retained provider diagnostic remains visible. |

Compiler corrections stay in their owning pinned build-time generator, not
post-generation patches or caller workarounds. Upstream commit
`c22dd77aa7f7392f997cf779f0c23e0b9aab1988` and its MIT notices are unchanged.
The generator handles native carriers/conversions, captured parameters, roots,
joins and updates; production contains none of its tooling. Captured-expression
evaluation explicitly requests interpretation rather than JIT.

This audit does **not** establish that the complete EF framework is warning-free
or support arbitrary reflected types/dynamic queries. It records the approved
preview-framework risk separately from demonstrated supported-product behavior.

## Scope and resources

All gates have finite process-group memory, swap and task limits. Docker's finite
aggregate slice contains its test process, build steps and actual containers.
Fixtures use inert local providers and actual stock Codex 0.162.1, Pi 1.0.0 and
pinned Conduit, not paid providers or production accounts. Linux x64 is the
verified target, not macOS or arbitrary host/runtime versions.

Disposable fixtures, databases, native test homes, build output and verification
caches are removed after their last use; concise evidence is retained. Active
resources, source worktrees, credentials, production state, research originals
and saved user/native histories are never cleanup targets.

Final cleanup removes 90 inactive generated directories (3.76 GiB logical), six
failed task-owned build containers and 30 task-owned image tags. Shared/preexisting
images, dependency caches and other worktrees remain untouched; no global Docker
prune is performed. The worktree retains 8.6 MiB of concise test evidence.

No deployment, npm publication, paid-provider quality certification, Rust sign-off,
production data change or automatic PR creation is part of this review.

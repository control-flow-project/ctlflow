# Crossfire monorepo instructions

Read docs/specification.md before implementation. It is the current architecture,
API, data and acceptance contract. Work is greenfield: WCBUBWHB, one current
implementation, no compatibility shims, aliases, duplicate owners or hidden fallbacks.

Backward compatibility, legacy support and dual paths are banned unless the user
explicitly authorizes a specific exception. This includes temporary bridges,
old/new API handlers, alternate state readers/writers, superseded implementations,
compatibility aliases and hidden fallback behavior in every service and tool.
Replace the owning model directly and update all affected callers, adapters,
schemas, generated artifacts, fixtures, tests and documentation together. Remove
the superseded path; do not leave it available behind a flag. Record any explicit
exception and its exact scope in these instructions, local memory and the ledger.
There are currently no project-wide compatibility exceptions.

On 2026-10-13 the owner explicitly authorized independently selected Node and
C# implementations of all three products in this monorepo. C# targets .NET 11,
NativeAOT and EF Core. All implementations must use one shared React UI, identical
wire contracts and directly interchangeable SQLite databases. This authorization
does not permit cross-language runtime fallbacks, compatibility handlers or
duplicate implementations within a selected language. On 2026-10-14 the owner
superseded the initial C#-before-Rust sequencing gate and authorized a separate
parallel Rust track in its own worktree. Both tracks retain the same shared UI,
API and SQLite guarantees and their own complete verification requirements.
Native implementation readiness and outstanding dependency decisions are
recorded in docs/architecture/native-implementations.md.
Native targets must retain equivalent service, application, package and test
ownership, following docs/architecture/native-layout.md. Use idiomatic target
patterns inside those boundaries. Knex alone creates/migrates all databases;
the SQLite adapter owns connections, query metadata and transactions in every
target. Do not add another database runtime package or a target-specific UI.

On 2026-10-14 the owner approved producing managed and NativeAOT .NET 11 builds
from the same C# source and initially deploying the managed build. EF remains the
C# data-access owner. NativeAOT diagnostics must remain visible and receive an
evidence-based disposition; their number is not proof of independent bugs or a
required EF fork. All tests must pass. This is explicit build selection, never an
automatic managed/Node fallback inside a native executable. Neither a checkpoint
nor an isolated proof establishes full product readiness in either native track.

On 2026-10-06 the owner approved a one-time npm release-age exception only for
the reviewed `source-map-js` 1.2.2 security patch. Native npm resolution changes
only that transitive lock entry. The persistent seven-day policy and existing
named exemptions remain unchanged. This does not authorize future exemptions,
compatibility paths or broader dependency updates.

Necessary forward data migrations convert a verified deployed schema into the
single current schema; they do not authorize concurrent old/new runtime paths.
Knex is the sole owner of database creation and migrations across every language
implementation. Database assets use the Lesser/Snapped structure under their
service: database/<database>/<backend>/migrations and seeds, with a per-database
knexfile and one-shot migration container. Deployment verifies a backup, stops
writers, runs the migration container and starts the selected implementation only
after success. Node and C# validate existing databases; neither creates schemas,
runs ORM migrations or silently migrates at startup. New databases follow the
same nesting and owner. File state and Conduit's externally owned RocksDB are
not SQL databases and are not converted into artificial Knex stores.
Preserve production data, credentials and native histories. Inventory actual
stores before removing obsolete migration inputs; never reset production to avoid
designing the correct migration. Required native protocol behavior is not an
excuse for speculative support of older contracts.

## Source ownership
All product code is under services/crossfire, services/fleetd or services/fleet.
Each service owns apps, packages, tests and product-specific assets. The repository
root owns documentation and workspace/build verification only. There is no global
package pool. Cross-service reuse uses declared package exports; application-source
reach-through is prohibited. Follow each service's AGENTS.md.

Reusable operator checks follow these service owners, not deployment projects.
Keep host, owner, fleet and release expectations explicit; site-specific branding,
TLS and deployment configuration remain site-owned.

## Engineering
Use functional modules, strict types without any, named exports, explicit .js
relative imports, Result for expected failures and boundary validation. Split
modules by responsibility near 600 lines. Domain code imports neither transport
nor concrete storage/adapter/UI modules. Composition roots wire implementations.
SQL tables/columns are singular snake_case; normalized domain state uses indexed
relations. Tinqer owns application queries. Raw SQL is schema/metadata only.
Expected transaction failures roll back. Native operations stay outside transactions.

## Execution and security
Enrollment, connection, filtering, blocked-mention notices, approvals, release
checking and telemetry use ordinary code, not model calls. A new software release
may deliver one receipt-confirmed notice per session/release so the model asks
the human for update consent and reads changed skill content. No silent upgrades.
Every Crossfire agent belongs to a fleet. fleetd hosts the shared listener and
owns native lifecycle through runtime adapters, including one-agent fleets.
The coding session performing setup remains independent; do not adopt its
process or conversation. Setup is noninteractive with private persisted defaults
and optional validated configuration. Human enrollment approval remains required.
Codex and Earendil Pi are implemented through the same owned-runtime ports.
Claude remains unimplemented; no standalone paths or placeholder adapters exist.
Pi requires verified native 1.0.0 RPC. Its owned extension implements native
control/instruction/input correlation, not terminal scraping or history writing.
All npm names use @ctlflow. Only @ctlflow/fleet and @ctlflow/fleetd may be public;
every other workspace remains private. Public builds cannot require publishing
internal modules or resolving source through the monorepo.
Controller labels/metadata are descriptive, not authentication or permissions.
No systemd/global services, global skills, unrequested host changes, production
resets or unrequested deployment. Preserve credentials and shared source work.
Do not delegate or start subagents without explicit authorization.

## Work discipline
A user request to deploy authorizes completing the in-scope release end to end,
including necessary coordinated version updates, verified non-main release
commits/pushes, authorized public package publication, backups, activation and
postdeployment verification. Do not stop for another routine confirmation.
Preserve excluded projects, shared work, production data and histories, deliberate
stopped selections and all quality gates. Report genuinely unavailable external
dependencies; provide manual PR links and never create PRs automatically.

For isolated changes with confidently local impact, run the affected tests and
necessary targeted checks. Run the full quality gates for cross-layer changes
or whenever the impact is uncertain. Never weaken a gate or claim verification
that was not performed.
Keep the unified spec and .analysis/20260929-164420-fleet-handover/necessity-ledger.md
aligned with decisions and evidence. .analysis/MEMORY.md is the local work memory.
Do not stop at intermediate milestones when completion is authorized. Never
weaken tests/gates or claim fixture-only evidence as real-provider certification.
Root commands coordinate typecheck, build, tests and architecture verification.

## Test execution
Runtime verification includes Codex and Pi. Claude remains unimplemented and has
no product test suite or retained legacy adapter. Prepare pinned native assets
once before isolated workers; do not select an optional runtime verification path.
Run isolated test files on every available CPU core. Build shared artifacts and
pinned browser assets once per run. Unconditional sleeps are forbidden: use
controlled clocks for timing logic and bounded observations for native I/O.
Fixtures dispose owned resources in reverse acquisition order. Record selected
runtimes, per-file timings and any failures without weakening assertions.

## Git
Never commit/push main, force-push, reset/clean/stash shared work or create PRs.
Authorized checkpoints go to the feature branch and are not release claims.
Provide manual /pull/new/<branch> links, one link per flat list item.
Git identity is jeswin <jeswinpk@agilehead.com>.

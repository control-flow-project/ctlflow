# Native implementation readiness

Status: **C# product source and shared tests written; integrated verification deferred.**
Evidence date: 14 October 2026. Baseline: `12df2c5`, version `0.1.20`.
Worktree: `/tmp/crossfire-csharp-20261013`.
Branch: `feat/csharp-nativeaot-20261013`.
Production, credentials, native histories and fleet selections remain unchanged.

## Approved architecture

- Implement every Crossfire, fleetd and fleet capability in .NET 11 with EF Core
  and SQLite. Produce managed and NativeAOT outputs from the same source.
  Initial managed deployment is explicitly approved.
- Keep the independently selectable Node implementation. Neither executable
  invokes another language implementation as a fallback.
- Keep one React UI, HTTP contract and canonical SQLite representation.
  A language switch must work directly with the same database.
- Use functional domain modules, immutable values and typed ports. Classes are
  restricted to required framework boundaries and actual resource ownership.
- The owner authorized a separate parallel Rust worktree on 14 October 2026,
  superseding the initial C#-before-Rust gate. This C# track contains no Rust
  implementation; each track must independently finish and verify all capabilities.
  Rust lands separately later and is not a completion dependency for this PR.
- Preserve data and forward migrations. No ORM-specific migration history,
  destructive initialization, compatibility handlers or silent substitution.
- Knex alone creates/migrates all owned SQL databases. Match the inspected
  Lesser/Snapped database/backend nesting and one-shot upgrade container.
  Application implementations only validate/open the resulting shared store.

## Implemented and verified boundaries

The web project owns its build and Element translation asset. The private common
client owns REST transport, binary streaming and Matrix password login.
Every owned consumer has migrated; former helper paths are removed without
aliases. Architecture tests reject backend/native dependencies from browser code.

The canonical migration owner is the private `@ctlflow/crossfire-data` package
at `services/crossfire/database`. It owns `management/sqlite/migrations`,
`management/sqlite/seeds` and `knexfile.management.mjs`. Its immutable schema-17
baseline describes application ID 1129465426: 63 singular application tables,
93 explicit indexes, 26 triggers, three roles, 36 permissions and 51 role grants.
The C# model generator derives all 63 typed entities and 111 foreign-key mappings,
including actual cascade semantics, from SQLite metadata. Its check mode detects
source drift. The generator inspects an actual Knex-created database. Neither
Node nor C# retains schema creation, forward conversion or startup migration.
Knex owns its migration/lock metadata separately from application data.

Managed SQLite acceptance passes existing-store validation, ordered foreign-key
insertion, filtered reads, joins, expected-failure rollback and uniqueness.
The implemented-core gate previously passed 752 managed / 734 NativeAOT assertions
(bounded retention scan counts vary with generated fixture ordering),
all six direct same-file Node/managed/AOT directions and schema 15/16 upgrades
through the shared Knex owner. Sixteen additional cases cover schema 13/14
exact rows, Unicode digests, rollback, repeat execution and unsupported-version
preservation followed by read-only application validation. Dynamic code and
reflection JSON are disabled in native execution. Nested rollback, owner-only
decisions, paginated listing, controller generation/credential/lease admission,
lifecycle claim/completion, broadcasts, name collisions, retired identity review,
room invitations/delegation/private-DM protection, native reconciliation and
wire/digest edge cases are included. Calendar differential verification covers
2,072 cases in each output; six cross-process file-lock directions include forced
exit. Current build-host and filesystem changes require an integrated rerun.
This is not full product certification.

C# modules now include authorization, member reads/changes, administrator
protection, principal initialization, session creation/authentication/expiry and
termination, audit persistence, canonical policy defaults, bounded HTTP JSON,
Matrix identity/profiles/provisioning/JWT authentication, room power enforcement,
owner conversations, invitations, events/notices and account deactivation.
Domain acceptance operates on real SQLite. Both managed and NativeAOT outputs
also pass 490 Matrix/HTTP assertions against actual pinned Conduit in each output: meaningful private DMs,
preserved identity during repair, exact native invitation checks, explicit mention
metadata, quoted-name non-controls and third-party isolation. Deactivation remains
separately bounded and tested at the protocol fixture boundary; the live gate does
not yet certify every Matrix command, history/file operation or server workflow.

Private filesystem operations use Linux descriptor-relative, non-symlink opens,
owned-file metadata, bounded reads and atomic durable writes. SQLite file opening
uses that owner. Full filesystem/native lifecycle coverage remains a release gate.

## EF build-time corrections

SDK and matching EF packages are pinned to .NET 11 RC1.
Build-only compiler sources pin upstream commit
`c22dd77aa7f7392f997cf779f0c23e0b9aab1988`; original MIT notices remain intact.
They are not a production runtime dependency.

Confirmed corrections are made at their owning generator:
- Emit the nullable annotation context before generated code.
- Recognize strongly typed DbContext method parameters.
- Translate captured method parameters and ordinary anonymous-object shorthand.
- Preserve native numeric literal carriers and semantic conversions.
- Keep generated-file constants, accessors, translator caches and namespaces
  scoped to their owning file instead of leaking into subsequent files.
- Register design services explicitly in compilation roots.
- Scope queries to their actual DbContext; preserve constructor-free captured
  scalar analysis, sealed-type materializers and independently filtered joins.
- Bind only DbSet roots before compilation; keep actual caller paging and
  nullable/Boolean/conditional values instead of folding compiler placeholders.
- Preserve implicit native argument conversions and original captured-array paths
  for first-class span operations; bind every boxed/nullable ExecuteUpdate setter.

No generated output is patched afterward. Callers are not required to introduce
artificial local aliases or redundant annotations to compensate for these defects.
Native acceptance executes the same repository queries and writes as managed code.

Native/trimming warnings remain visible and require audit. Warning counts alone
do not establish runtime bugs or prove that a major EF runtime fork is needed.
The earlier fork/direct-SQLite decision proposal is **superseded** by the owner's
managed-plus-NativeAOT approval. EF and .NET 11 are not replaced.

## Native engine progress

The last completed runtime gate passes 465 checks in each managed and NativeAOT
output against stock Codex 0.162.1 and an inert local provider. It covers private
process ownership, protocol bounds/cancellation/deadlines, exact advertised native
settings, API-backed message evidence, durable restart recovery, actual turn
interruption before replacement input, and developer instruction injection with
read-only native-history evidence. Unchanged instructions are stored once and
do not execute a model turn. Actual process restarts preserve the same native
history; an unsent original message is retained verbatim in a private file and
supplied through a newly verified restart instruction. No paid provider is used.

Scoped Codex histories, reset, authentication refresh, attachment metadata,
observations and owner decisions pass that preceding gate. Pinned Earendil Pi
1.0.0 runs its shared owned extension through real RPC, including tools, cached
usage, hard interruption, owner questions, shared/per-room isolation, auth
refresh, reset and uncertain-original recovery. Eighteen focused Node Codex/Pi
regressions also pass. Those results precede the current listener/controller/CLI
and protocol-writer edits and do not certify them. The preceding runtime publish
has no trim/AOT warnings; the separate server EF warning audit is unfinished.

## Written integration and remaining verification

| Area | Remaining completion requirement |
|---|---|
| Portable API | All 92 operations are bound; integrated executable-level contracts are written but unrun |
| Domain/data | Fleet, enrollment, rooms, wake-ups, publication, decisions, telemetry and retention are written; rerun complete integrated evidence |
| Schema | Shared Knex owner, backup/migration container and direct same-file reopening are written; new operator/container wiring remains unverified |
| Matrix/listener | Sync/history/files, authorization, hard steering, owner output/decisions, typing, schedules and maintenance are written; execute shared actual-Conduit scenarios |
| Native engines | Existing 465-check managed/AOT checkpoint is green; latest integration/protocol changes require rerun |
| fleetd | Native lifecycle, durable unfinished work/intents, reset export, controller lease, failure/stop receipts, enrollment and all 19 daemon operations are written; integration unverified |
| Fleet CLI | Local/SSH commands, no-question setup, installed sibling controller launch, software updates, contexts and terminal pointers are written; integration unverified |
| Distribution | Managed/self-contained and actual AOT publication for all three products, common UI/tools and owned container cleanup are written; builds not run |
| Shared tests | One executable matrix and service-owned scenarios cover Node/C#/Rust without backend-specific assertions; every selected target runs both native engines |
| UI/gates | Execute shared real browser checks, full applicable Node/C# suites, containers/distributions, architecture, EF diagnostic audit and performance review |

The coding closure review replaces untracked startup restoration with the same
per-instance recovery owner used after failure. Start results are installed under
the controller's state lock only while their cancellation and saved desired intent
still permit it. Individual/fleet stop and daemon shutdown wait for unresolved
startup cleanup. Lifetime callbacks are registered outside that lock and retained
only for the still-current runtime. Recovery startup concurrency remains bounded.
Service-owned internal cases hold startup at a deterministic barrier and check
these races, stop completion and exact-history resume in both .NET build modes.

Instance cleanup has one owner on both failed initialization and normal shutdown.
It attempts receiver, observer, activation and native cleanup even after another
step fails; a native-close receipt and listener-ownership release require actual
native disposal. Connection, activity, decision and report owners expose the same
in-progress disposal task to every caller instead of returning early. The shared
large-input fixture pauses delivery before queuing its batch, avoiding a timing
assumption about debounce. These final changes are written, not verified.

The same review removes a reversed C# dependency: the setup descriptor is now a
pure Crossfire domain value, with wire parsing owned by contracts. Canonical UUID
syntax belongs to the kernel, not HTTP validation. Fleetd's runtime port exposes
listener activity as a value rather than the concrete listener control owner.
The root architecture gate now checks service-owned C# project references, pure
domain imports and build/runtime dependency separation, with negative fixtures.
Publication disables persistent compiler/build servers so its work cannot reuse
an unbounded server outside the selected resource scope. These gates are unrun.

The owner explicitly requested completing code before running further tests.
No new build, test, lint or deployment gate has been started in this coding phase.
Implementation being written is **not release certification**. There is no
production release/deployment/publication or Rust completion claim. Rust remains
in its separately authorized worktree and PR.

The shared integration suite supplies executable commands, not alternate expected
values. It checks protected routes, signup/origin/CSRF, exact enrollment and
identity collisions, native invitation/DM authority, controller/decision receipts,
static publications, wake revisions, real native model settings, immediate
steering/DM evidence, large-file delivery, scoped/global/unread queries, saved
history/stop intent, actual CLI and unchanged mobile/desktop React. Configured
servers reopen the identical SQLite file. Node plus both C# modes form this PR's
matrix; Rust joins the same scenarios when its separate output is available.
Internal unit tests and full release gates remain necessary beyond these cases.

## Verification discipline

The two prior Codex failures reproduced on unchanged baseline source. Inspection
showed test assumptions, not adapter defects: interrupted queued input was already
durably recorded, and the stop fixture allowed native work to finish before the
control arrived. Corrections preserve exact payload/turn/receipt assertions and
hold native I/O where the test is exercising cancellation. All three focused
real-Codex cases pass. Fake tests of genuinely unrecorded-input replay remain.

Earlier Conduit preparation deadlines cleared without restarting Docker or other
projects. Full Node verification now runs all 186 files with real Conduit,
Codex, Pi, browser and fleet integration. Final integrated evidence belongs to
the dated necessity ledger. Targeted passes are not substitute full gates.
Native fixtures establish recorded input before asserting no replay and preserve
verified input on cancellation; a held model response does not imply native
receipt persistence is held.

The actual isolated Knex migration container passes fresh initialization,
schema-13 upgrade, repeat schema-17 execution and schema-18 rejection.
Upgrade code stops writers, verifies a backup when needed, runs the migration
container and starts the server only after success. Production remains unchanged.

All verification uses bounded process-group resources. Production stores,
research originals, user histories and shared checkouts are untouched. Recreated
fixtures, compiler output and caches are removed after their last required use;
concise evidence is retained instead of fixture trees.

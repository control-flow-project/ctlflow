# Native implementation readiness

Status: **Incomplete C# checkpoint. Separate parallel Rust track authorized.**
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
- Preserve data and forward migrations. No ORM-specific migration history,
  destructive initialization, compatibility handlers or silent substitution.

## Implemented and verified boundaries

The web project owns its build and Element translation asset. The private common
client owns REST transport, binary streaming and Matrix password login.
Every owned consumer has migrated; former helper paths are removed without
aliases. Architecture tests reject backend/native dependencies from browser code.

The canonical schema asset is
`services/crossfire/packages/data/sqlite/schema.json`. Node and C# consume that
same DDL. It describes schema 17/application ID 1129465426: 63 tables,
93 explicit indexes, 26 triggers, three roles, 36 permissions and 51 role grants.
The C# model generator derives all 63 typed entities and 111 foreign-key mappings,
including actual cascade semantics, from SQLite metadata. Its check mode detects
source drift. There is no independent EF-created schema.

Managed SQLite acceptance passes initialization, ordered foreign-key insertion,
filtered reads, role-permission joins, expected-failure rollback and uniqueness.
The last complete core gate passes 103 assertions in both managed and NativeAOT
executables, six direct Node/managed/AOT database interchange directions, and
version 15/16 forward migrations against Node's actual migration results.
Native execution reports dynamic code and reflection JSON disabled. Subsequent
nested-transaction checks pass 106 managed assertions. Newly added decision and
listener modules build successfully but still need their focused acceptance and
another complete native run. These results are not full product certification.

C# modules now include authorization, member reads/changes, administrator
protection, principal initialization, session creation/authentication/expiry and
termination, audit persistence, canonical policy defaults, bounded HTTP JSON,
Matrix identity/profiles/provisioning/JWT authentication and account deactivation.
Managed acceptance exercises these domain operations against real SQLite and
Matrix protocol requests against a loopback HTTP fixture. This fixture does not
constitute real-Conduit certification.

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

No generated output is patched afterward. Callers are not required to introduce
artificial local aliases or redundant annotations to compensate for these defects.
Native acceptance executes the same repository queries and writes as managed code.

Native/trimming warnings remain visible and require audit. Warning counts alone
do not establish runtime bugs or prove that a major EF runtime fork is needed.
The earlier fork/direct-SQLite decision proposal is **superseded** by the owner's
managed-plus-NativeAOT approval. EF and .NET 11 are not replaced.

## Remaining required work

| Area | Remaining completion requirement |
|---|---|
| Portable API | All 92 REST operations, strict request/response validation and identical representations |
| Domain/data | Complete remaining fleet, enrollment, rooms, wake rules, publication, runtime, telemetry and retention operations |
| Schema | Complete versions 13/14 forward migrations; extend verified 15/16 and same-file checks to every supported store |
| Matrix | Complete room authority, membership, owner conversations, history/sync, files and real-Conduit verification |
| Native engines | Complete Codex/Pi RPC, approvals/questions, interrupts, receipts, recovery, activity and usage |
| fleetd | Complete shared listener, owned process lifecycle, persisted history, setup and private daemon API |
| fleet CLI | Complete local/SSH commands, installation, distributions and resumable lifecycle |
| UI | Run unchanged real browser workflows against C#; no second UI implementation |
| Gates | Entire Node and C# suites, managed/native parity, warning audit, architecture and performance review |
| Rust | Separate parallel track; complete all capabilities and verify the same shared UI, API and stores |

C# is **not a complete Crossfire server or fleet runtime** yet.
There is no production release, deployment, publication or Rust completion claim.

## Verification discipline

The two prior Codex failures reproduced on unchanged baseline source. Inspection
showed test assumptions, not adapter defects: interrupted queued input was already
durably recorded, and the stop fixture allowed native work to finish before the
control arrived. Corrections preserve exact payload/turn/receipt assertions and
hold native I/O where the test is exercising cancellation. All three focused
real-Codex cases pass. Fake tests of genuinely unrecorded-input replay remain.

The latest complete Node test invocation is currently stopped during pinned
Conduit preparation: Docker create/remove repeatedly exceed their unchanged
30-second deadline while host disk I/O is heavily pressured. This is not a green
gate, an optional-runtime waiver or permission to remove tests. No Docker daemon
or another project's processes have been restarted or removed.

All verification uses bounded process-group resources. Production stores,
research originals, user histories and shared checkouts are untouched. Recreated
fixtures, compiler output and caches are removed after their last required use;
concise evidence is retained instead of fixture trees.

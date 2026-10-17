# Rust integration review

Review dates: 16–17 October 2026. Coordinated version: 0.1.20.
Main `7378d12` is integrated into `feat/rust-native-20261014`.

The parent session owns this branch and the final quality gate. The earlier
Rust-only restriction no longer applies: confirmed defects are corrected in
their Node, C# or shared owner in this PR. Other repositories, production data,
native user histories, publication and deployment are outside this review.

## Ownership

Node, C# and Rust implement Crossfire, fleetd and Fleet. Nineteen semantic package
pairs match by responsibility. React, REST declarations, external assertions,
agent-tool assets and Knex migrations each retain one shared owner. Native
executables do not delegate backend requests to another implementation.

Rust uses native HTTP, Matrix HTTP and Diesel queries. C# uses its .NET HTTP
adapters and EF mappings; Node uses its declared adapters and Tinqer queries.
Knex alone creates or migrates the common SQLite schema. Runtime adapters reject
missing or unsupported schemas instead of creating a parallel data model.

The inventory covers 804 Node files, 526 C# files and 592 Rust files. It includes
source, tests, manifests, generated metadata and build inputs. A file association
is an ownership check, not proof of equivalent behavior.

- [Per-file review and owning corrections](native-file-audit.md)
- [Per-file ownership map](native-file-map.tsv)
- [Structure and native differences](native-layout.md)

## Parent review corrections

| ID | Owner and correction |
| --- | --- |
| RQ-001 | Canonical container source identity includes the root Cargo manifest, lock and toolchain; removes the superseded Rust-specific corrective guard |
| RQ-002 | Strict UTF-8 and Unicode admission, including fragmented Docker output; kernel-owned whole-scalar UTF-16/UTF-8 bounds; consistent native failure journals, observations and steering excerpts |
| RQ-003 | Declared public/private HTTP limits, exact binary bytes, explicit private no-proxy transport and minimum-one-page collection metadata |
| RQ-004 | Bound SQLite LIKE queries without host Unicode casing; shared filter/count/order/page rules |
| RQ-005 | Atomic telemetry admission and wire-unit-safe labels; invalid summaries cannot partially mutate counters |
| RQ-006 | Full fleet-directory pagination and command validation before any controller activation; consistent label admission and bounded SSH socket paths |
| RQ-007 | Resolve preceding native input before recording a new steering publication; failure/reopen tests preserve the original pending input |
| RQ-008 | One finite removal deadline, immutable container identities and both primary/cleanup failures retained; fixtures dispose exact owned resources |
| RQ-009 | Narrow rustls 0.23.45 to 0.23.46 security update; no audit suppression, TLS relaxation or unrelated dependency changes |
| RQ-010 | Atomic synchronous history maintenance without claiming a query slot; ordinary browsing cannot collide with a status check |
| RQ-011 | One shared installed/container matrix runner isolates target processes within the same finite resource slice; blocking native commands cannot starve another target's browser or heartbeat |
| RQ-012 | Build a label-only derivative instead of snapshotting an unused container; use the existing five-minute artifact-preparation budget, retain 30-second metadata probes and all archive import/readiness assertions |
| RQ-013 | Distribute the complete operator/backend Cartesian product across its owning target workers; verify all 16 unique pairs once instead of repeating them 64 times under the same one-hour target budget |
| RQ-014 | Own Docker capture deadlines in the command adapter; remove caller-specific overrides and retain operation names on failures |
| RQ-015 | Native acceptance waits for each independent WebSocket notification before asserting exact-once delivery; sender-lookup acceptance controls business time separately from I/O and observes explicit polling barriers rather than racing maintenance |
| RQ-016 | Stop is a lifecycle mutation, not a metadata read; cancellation and normal exit use one stop/removal owner with one overall 120-second deadline, retaining the 15-second graceful stop and complete launcher teardown |

The shared TLS fixture uses a distinct authority and CA:FALSE server certificate.
It has one service-owned test-support export. Native certificate, chain and
hostname validation stays enabled. The two verification coordinators share one
short, private, identity-checked fixture-root allocator; waiting for real native
I/O does not advance the listener test's controlled maintenance clock.

The complete verification record, including failed attempts and final gate
outcomes, is maintained separately. Earlier scoped passes are historical
evidence, not final four-target certification.

The parent full gate passes on all four targets, including actual container
recovery and shared Knex migrations. The linked parent record defines the tested
platform, native-runtime scope, resource bounds and remaining dependency limits.

- [Parent quality gate and findings](../verification/20261016-rust-quality-gate.md)
- [Executable shared scenario coverage](../verification/shared-contracts.md)
- [Earlier Rust-only integration evidence](../../.analysis/20261016-rust-main-integration/verification.md)
- [Earlier 15 October evidence](../verification/20261015-rust-integration.md)

## Limits

The current native distributions target Linux x64. Tests use actual pinned
Codex/Pi engines with inert providers and actual pinned Conduit. They do not
establish paid-model quality, sustained-load capacity, every power-loss boundary
or unselected platforms. The .NET 11/EF pins are previews; NativeAOT dependency
diagnostics remain visible.

Rust's packaged Linux guard observes the exact controller lifetime and terminates
its owned process group. Node/C# can retain a native writer after SIGKILL and
refuse a competing writer through the native lock. A subprocess that deliberately
escapes its group is outside the guard's protection. These are documented native
target differences, not competing backends or a universal crash guarantee.

The deliverable is one non-main branch prepared for manual PR creation.
Local builds and passing fixtures are not publication or deployment.

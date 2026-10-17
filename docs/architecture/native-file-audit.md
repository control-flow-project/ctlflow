# Native implementation file audit

Baseline: main `7378d12`, integrated on the isolated Rust feature branch.
The parent review includes confirmed fixes in every affected Crossfire owner.
No other repository or deployed data is changed.

## Coverage

The [per-file map](native-file-map.tsv) lists every Node/C# file, its semantic
Rust/shared owner and disposition. `node scripts/native-file-inventory.mjs`
reads each complete file and emits its identity, declarations, size and owner.
Structure verification rejects unclassified packages, missing counterparts and
stale maps. Association alone does not prove functional equivalence.

| Product | Node files | C# files | Coverage |
| --- | ---: | ---: | --- |
| Crossfire | 705 | 477 | Server, domain, contracts, adapters, queries, assets, tests, operators and build |
| fleetd | 74 | 37 | Daemon, lifecycle, execution composition, state, setup and tests |
| Fleet | 25 | 12 | CLI, daemon client, setup, SSH, packaging and tests |
| Total | 804 | 526 | 1,330 files, with no source/test/manifest/guide exclusions |

These owners map to 592 Rust files or explicit shared assets. Review follows
configuration/validation, authorization/transactions, filter/count/order/page,
input/receipt/restart, process/lock/cleanup and declaration/generator/package
paths. Public behavior uses one external assertion bank.

## Owning corrections

| Area | Current model | Verification |
| --- | --- | --- |
| Pagination | Canonical decimal parameters, bounded collection metadata, one page for empty collections, full CLI directory traversal | Native boundary tests and shared public/private/installed CLI contracts |
| Public HTTP | Explicit trusted ingress, mapped-IP normalization, independent per-client/global budgets, bounded expiry | Controlled-clock tests and real TLS ingress contracts |
| Wire data | Fatal UTF-8 decoding, rejection of unpaired Unicode values/keys and whole-scalar bounds in the correct wire unit | Corrupt-file/native JSON tests, shared unchanged-state assertions and receipt/journal regressions |
| Native HTTP | Explicit public/private bounds, exact binary uploads, cancellation and private no-proxy transport | Real rejecting-proxy positive control and request/metadata boundary tests |
| Queries | Bound SQLite LIKE without host case folding; identical filters, creation/ID ordering and page counts | Repository tests and shared agent/discovery/fleet/wake/report scenarios |
| State | Shared Knex-created schema, runtime validation, transactional rollback and same-file interoperability | Bidirectional SQLite, journal, lock and actual migration proofs |
| Steering | Predecessor settlement precedes recording a new publication; input and exact history remain recoverable | Fault/reopen recovery and installed native runtime tests |
| History inspection | Synchronous maintenance never claims an active query slot; real unread ownership remains exclusive | Deterministic mutex/lease regression and unchanged four-target room/global history contracts |
| Telemetry | Atomic bounded summaries; safe labels; invalid input does not poison counters or heartbeats | Cross-language collector and overflow regressions |
| Lifecycle | Fleetd alone owns execution; saved history, explicit operation identity and native writer locks | Actual Codex/Pi inert-provider, restart, terminal, steering and process-group proofs |
| Operator | One SQLite lifetime lock, inspect both exact container identities, ordered backup/Knex/start | Concurrent/crashed/operator-orphan and installed container assertions |
| Removal | One finite 120-second removal budget; observe in-progress deletion; retain primary and cleanup errors | Injected dual-failure tests and real Docker/Knex scenarios |
| Packaging | Immutable source/image/release identity, bounded manifests/archives, no source-built activation fallback | Fingerprint mutation, export/import, corrupt archive and mismatched-label tests |
| Calendar | Shared checksum-pinned IANA archive and canonical compiler, independent of host timezone data | Generated-table checks and cross-target calendar comparisons |
| Dependency security | Narrow patched rustls lock entry; strict TLS remains enabled | RustSec audit without ignored advisories plus native HTTP/runtime tests |
| Fixtures | One TLS owner and one short private verification-root allocator; controlled time separate from native I/O observation | Fixture ownership/socket-budget/cleanup and clock regressions |

## Native structure

General ownership follows [the layout](native-layout.md). Native process, HTTP,
TOML and ORM primitives stay in their adapters. Rust tests sit beside their
crate; C# tests retain managed/AOT projects and Node uses isolated test files.

The EF design-time compiler is not a missing Rust feature: Diesel metadata is
generated from the common Knex-created schema. No empty EF counterpart, second
migration owner or target-specific UI is introduced.

JavaScript agent-tool assets, the Pi extension, optional operator tools and
external contract fixtures have one shared owner. Native executables do not
invoke another language backend as a fallback. The Linux parent pidfd guard is
a process-adapter primitive, not arbitrary-subprocess containment.

## Evidence

Current-source verification and failed-attempt diagnoses are recorded in the
parent quality-gate report. Historical Rust-only passes do not replace the
complete four-target gate. No deployment, registry publication or paid-provider
certification is implied.

- [Parent quality gate](../verification/20261016-rust-quality-gate.md)
- [Integration review and native limits](rust-review.md)

# Native implementation file audit

Baseline: main `a9c7c42`, integrated on the isolated Rust branch at `e033d42`.
This review extends the earlier package-level assessment with per-file coverage.
Current verification is recorded separately from historical results.

## File coverage

The accompanying [per-file map](native-file-map.tsv) lists every Node/C# file,
its semantic Rust/shared owner and disposition. Running
`node scripts/native-file-inventory.mjs` reads each complete file and emits its content
identity, declarations, size and association. Structure verification rejects
unclassified packages and missing counterparts. This is an inventory, not a
claim that static association proves functional equivalence.

| Product | Node files | C# files | Scope |
| --- | ---: | ---: | --- |
| Crossfire | 702 | 476 | Server, domain, contracts, adapters, query/mapping code, assets, tests, operators and build |
| fleetd | 74 | 37 | Daemon, lifecycle, execution composition, persisted state, setup and tests |
| Fleet | 25 | 12 | CLI, daemon client, setup, SSH, packaging and tests |
| Total | 801 | 525 | 1,326 files, with no source/test/manifest/guide exclusions |

The source review follows producers through consumers rather than treating matching
filenames as proof: configuration/validation; authorization/transactions;
filter/count/order/page/hydration; input/receipt/restart; process/lock/cleanup;
and declaration/generator/package/container. Public behavior is then exercised
through one external assertion bank. This fork now edits Rust product code only;
Node/C# differences are recorded for the main session rather than changed here.

## Corrected differences

| Finding | Correct owning change | Verification |
| --- | --- | --- |
| Rust retained permissive numeric pagination and zero-page empty collections | Canonical decimal parser shared by REST/daemon; every empty-page producer and native-client validator agree | Boundary unit tests and shared public/private pagination |
| Rust retained the old client-only limiter | Explicit trusted peers, mapped-IP normalization, exact forwarding header, independent per-client/global budgets, bounded expiry and native/REST error headers | Controlled-time unit tests and real TLS ingress contracts |
| Rust operator had no cross-language lifetime lock or orphan reconciliation | Same SQLite operator lock; inspect both names before changing either; exact labels/IDs; confirmed stop/removal before backup/Knex/start | Native command checks and actual concurrent/crashed/container-orphan contracts |
| Main replaced source-built activation with transferable packages | Rust verifies the bounded manifest/archive, imports missing exact images, validates platform/release labels and only then reconciles writers | Shared actual export/import, corrupt archive, mismatched label, image-owned health and operator/orphan assertions |
| Native readiness and asynchronous deletion needed the same explicit owners | Header-only native health probes and bounded exact-ID state observation; an already-removing container is not stopped/deleted again | Real HTTP response/cancellation tests, subprocess transition tests and actual Docker removal |
| SYM-001/002 define canonical operator arguments | Rust rejects repeated options and every noncanonical port before the instance lock or Docker; configured defaults receive the same bounds | Same shared operator assertions as the concurrent Node/C# fix, against the compiled Rust release; default-port unit regression |
| Search compilers produced different predicates; directory order and active filters also differed | Rust uses bound SQLite LIKE, no host Unicode normalization, canonical creation-time/ID order and active identity fences | Rust repository checks and shared agent/discovery/fleet/wake/report assertions; other adapters remain the main session's responsibility |
| Invitation/enrollment equal-time tie order differed | Reference ascending ID tie-breaker | Query owner review plus integration/repository gates |
| Native HTTP client lacked declared binary upload | One bounded HTTP implementation for JSON and exact binary bytes; common operation/auth/error owner | Actual HTTP binary, invalid-kind, size, cancellation and metadata checks |
| Native client defaults differed and ambient proxies could affect private traffic | Rust has explicit public/private bounds and no ambient proxy path | Real HTTP under a rejecting forced proxy plus native transport gates; C# changes deferred |
| Rust catalogue generation depended on host timezone data | Derive the catalogue from the shared checksum-pinned archive and reuse the canonical compiler; no second pin or host-data compiler | Catalogue rejection tests, generated-table check and 2,072 calendar comparisons while host tzdata has a different version |
| Some other implementations substitute malformed UTF-8 | Rust retains fatal decoding and refuses malformed HTTP JSON without changing state | Rust corrupt-file/boundary checks; Node/C# proposals preserved but not applied |
| Fleet label Unicode bounds differed | One UTF-16 length/C0/DEL contract in daemon inputs/domain | Shared actual-daemon Unicode cases |
| Rust could activate a controller for malformed start syntax | Validate before launch | Identical installed CLI negative case |
| Rust telemetry labels were unbounded | Scalar-safe truncation, bounded summary labels and atomic count admission without a runtime activation whitelist | Rust collector tests exercise Unicode/empty/control labels, adapter-neutral usage and overflow preservation; Node/C# proposals deferred |

## Deliberate native structure

General ownership matches [the layout](native-layout.md). Native-specific process,
HTTP, TOML and ORM primitives stay in their adapters. Rust tests sit beside their
crate; C# tests retain managed/AOT projects and Node uses isolated test files.
The EF design-time compiler is not a missing Rust feature: Diesel metadata comes
from the same Knex-created schema through its own generator. No artificial EF
compiler copy, empty directory or target-specific migration/UI owner is added.

The JavaScript agent tool, Pi extension, optional operator tooling and common
contract fixtures remain single shared assets, not missing native ports. Native
executables never invoke Node/C# as backend fallback. The Rust parent pidfd guard
is an explicit process-adapter primitive; its scope is recorded in the runtime
review, not extended into an unsupported arbitrary-subprocess guarantee.

## Verification state

Current internal, packaging and installed native setup checks pass. The common
external TLS fixture now owns a separate authority and valid server leaf;
native certificate verification is unchanged. See [the Rust review](rust-review.md) for current results
and [the main-session handover](../../.analysis/20261016-node-csharp-findings/README.md)
for excluded fixes. Earlier cross-target results used source that has since been
restored and are not final-source certification. No deployment or publication is
implied.

# Rust integration review

Review date: 16 October 2026. Coordinated version: 0.1.20.
Main `09fec7c` was merged into `feat/rust-native-20261014` at `8ffc9db` before
this review. Work is confined to the isolated Rust worktree; it does not deploy,
publish packages, reset data or change peer worktrees.

The owner subsequently restricted product-code edits to Rust. Node/C# product
files, tests, assets, the C# solution and publisher match main exactly. Their
findings are handed to the main session, not silently repaired by this fork.

## Ownership

Three implementations own the same Crossfire, fleetd and Fleet products.
Nineteen semantic package pairs match by responsibility. Shared React, external
assertions, REST declarations, agent-tool assets and Knex migrations each have
one owner. Rust uses native HTTP, Matrix HTTP and Diesel queries; it does not
delegate backend requests to Node/C#.

The file review reads all 790 Node and 523 C# owned files, including manifests,
tests, build inputs, generated metadata and operator tools, and maps them to 585
Rust files or explicitly shared owners. Matching paths alone do not prove
behavior. Producer/consumer inspection and executable regressions check the
affected decisions.

- [File audit and corrections](native-file-audit.md)
- [Per-file ownership map](native-file-map.tsv)
- [Shared structure and native differences](native-layout.md)

## Corrections after the main merge

| Owner | Change |
| --- | --- |
| Contracts and collections | Canonical decimal pagination, one-page empty collections, strict client metadata, deterministic ordering and one SQLite LIKE search rule |
| Server HTTP | Literal trusted ingress, bounded per-client/aggregate admissions, malformed UTF-8 refusal and unchanged-state regressions |
| Container operator | Lifetime SQLite ownership, inspect both exact identities before cleanup, shared backup/Knex/start ordering |
| Native transport | Exact binary request bytes, public/private bounds, cancellation and explicit private proxy bypass |
| Listener statistics | Scalar-safe labels, shared runtime/session validation and atomic overflow refusal without poisoning heartbeats |
| Native assets | Rust's Pi asset is generated from the unchanged shared extension source, not a separate runtime implementation |
| Calendar verification | Rust uses the checksum-pinned IANA source and derived catalogue, independent of host timezone updates |
| Fleet CLI | Full directory pagination and invalid-command rejection before controller activation |
| Verification wiring | Rust invokes the common assertions without editing Node/C# product implementations or removing existing assertions |
| Documentation/distribution | Separate target guides, Rust's standalone bundled README, explicit prerequisites and factual failure boundaries |

No obsolete handlers, alternate state readers, runtime migrations or silent
model/backend substitutions are retained. Necessary forward data conversion
remains separate from runtime admission.

## Verification

Current Rust-only evidence passes architecture, type checking, formatting,
warnings-denied Clippy, 260 tests in 133 compiled targets, 2,072 Node/Rust calendar
comparisons, bidirectional SQLite/journal/lock proofs, actual Conduit authority
and Linux x64 release packaging. Actual Codex and Pi adapter tests use inert
providers. This does not establish that every installed product scenario passed.

The installed assertion bank exposes a shared Node-owned TLS fixture defect:
its server certificate has CA:TRUE. Rust correctly rejects it as
CaUsedAsEndEntity. Controller enrollment and CLI setup cannot complete through
that fixture. Certificate verification remains enabled. Independent follow-up
passes all 29 Rust container checks, including every REST operation, actual
Element/media, both browser widths and all operator/orphan scenarios. Actual
Knex migration containers pass schemas 0/13/17 and reject future 18. The 28
root tooling regressions and checks of 63 current Markdown guides also pass.

The scoped command is `npm run verify:rust -- /absolute/new-evidence-directory`
inside a finite 16 GiB, zero-swap, 2,048-task scope. It retains the failed outcome
and exits nonzero; an unsuccessful gate is not certification. The main session
owns the fixture correction and the final four-target `verify:parity` run.

- [Main-session findings and preserved proposals](../../.analysis/20261016-node-csharp-findings/README.md)

- [Executable scenario coverage](../verification/shared-contracts.md)
- [Earlier 15 October evidence; not current-source certification](../verification/20261015-rust-integration.md)

## Limits

The current distributions target Linux x64. Tests use actual Codex/Pi engines
with inert providers and actual pinned Conduit. They do not establish paid-model
quality, every subprocess failure, sustained-load capacity or other platforms.
The .NET 11/EF pins remain previews with visible NativeAOT diagnostics.

Rust's packaged Linux guard observes the exact controller lifetime and terminates
its owned native group. Node/C# can retain a native writer after SIGKILL and
refuse a competing writer through the native lock. Tools that escape their group
are outside the guard's protection. Documentation distinguishes these concrete
target behaviors instead of claiming parent-death handling is impossible.

Local package creation and passing fixtures are not publication or deployment.
The authorized deliverable is one pushed non-main branch for manual PR creation.

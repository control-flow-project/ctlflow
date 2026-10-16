# Rust integration review

Review date: 16 October 2026. Coordinated version: 0.1.20.
Main `7378d12` was merged into `feat/rust-native-20261014` at `9e90bdf` before
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

The file review inventories all 801 Node and 525 C# owned files, including manifests,
tests, build inputs, generated metadata and operator tools, and maps them to 591
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
| Container packages | Same bounded manifest/archive and exact-image/release checks; only --package activates a backend, with no source compilation or language fallback |
| Native readiness/removal | Image-owned HTTP/Matrix probes and bounded exact-ID deletion; an existing removal is observed without competing stop/delete commands |
| Operator arguments | Repeated options and noncanonical ports fail before state-lock creation or Docker; defaults obey the same port bounds |
| Native transport | Exact binary request bytes, public/private bounds, cancellation and explicit private proxy bypass |
| Listener statistics | Scalar-safe labels, shared runtime/session validation and atomic overflow refusal without poisoning heartbeats |
| Native assets | Rust's Pi asset is generated from the unchanged shared extension source, not a separate runtime implementation |
| Calendar verification | Rust derives its catalogue from the shared checksum-pinned IANA archive and reuses the canonical compiler, independent of host timezone updates |
| Fleet CLI | Full directory pagination and invalid-command rejection before controller activation |
| Verification wiring | Rust invokes the common assertions without editing Node/C# product implementations or removing existing assertions |
| Documentation/distribution | Separate target guides, Rust's standalone bundled README, explicit prerequisites and factual failure boundaries |

No obsolete handlers, alternate state readers, runtime migrations or silent
model/backend substitutions are retained. Necessary forward data conversion
remains separate from runtime admission.

## Verification

Current Rust-only evidence passes architecture, type checking, formatting,
warnings-denied Clippy, 265 tests in 136 compiled targets, 2,072 Node/Rust calendar
comparisons, bidirectional SQLite/journal/lock proofs, actual Conduit authority
and Linux x64 release packaging. Actual Codex and Pi adapter tests use inert
providers. All 58 installed-product assertions now pass, including real daemon
delivery, steering, restart, CLI/SSH and browser scenarios. The common fixture
now uses a CA:FALSE server certificate signed by a distinct test authority;
strict native certificate, hostname and chain validation remains enabled.

The subsequent isolated parser change passes warnings-denied Clippy, six native
checks, the five shared CLI checks against the compiled release, and type
checking. Thirty-two root tooling regressions and checks of 65 current Markdown
guides pass. The complete gate and final targeted results are recorded in the
dated integration report; earlier failed runs are not substituted for it.

All 32 actual-container assertions pass. Actual Knex migrations pass schemas
0/13/17 and reject future 18 on an unchanged isolated retry. The first full
run remains failed: Docker exceeded the Node-owned exact-container cleanup
deadline after correctly rejecting schema 18. Its cleanup failure and retained
primary cause are handed to the owning session, not hidden by the retry.

The final main merge adds SYM-001/002/003. It changes no Rust runtime source or
shared operator assertions relative to the verified Rust checkpoint. The merged
build, validation and shared operator wiring receive focused verification.

The scoped command is `npm run verify:rust -- /absolute/new-evidence-directory`
inside a finite 16 GiB, zero-swap, 2,048-task scope. It retains the failed outcome
and exits nonzero; an unsuccessful gate is not certification. This Rust-only
scope does not rerun or certify all four target combinations. The main session
owns remaining Node/C# findings and the final four-target `verify:parity` run.

- [Current integration evidence and remaining owner findings](../../.analysis/20261016-rust-main-integration/verification.md)

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

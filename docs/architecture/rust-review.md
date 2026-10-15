# Rust implementation review

Review: 15 October 2026. Coordinated version: 0.1.20.
Baseline: merged Node/C# main `fe3e154f604d0abb9abd3c7a260c925a0a4a734f`.
Scope: isolated `feat/rust-native-20261014` worktree; no production deployment,
registry publication, data reset, other worktree changes or automatic PR.

## Design review

| Requirement | Owner and verification |
| --- | --- |
| Equivalent products and package boundaries | Three Rust applications and 19 checked semantic package pairs; native graph and negative architecture fixtures |
| One UI and wire contract | Shared React, API declarations and installed-product assertions; no Rust UI or alternate handlers |
| One directly interchangeable SQLite model | Shared Knex schema/migrations; generated Diesel metadata, same-file Node/native proofs, immutable schema verification and pre-upgrade backups |
| Independent native server | Rust HTTP/Matrix/SQLite, signup/origin/cookie/CSRF, enrollment, identities, room authority, wake rules, reporting, scheduling, retention and sandboxed content |
| Independent native fleet products | Execution adapter owns enrollment/listener/native wiring; daemon owns private Unix API; CLI uses that API locally and over strict SSH |
| Runtime parity | Real Codex and Pi behind pure owned-runtime ports, exact options/receipts/history, hard mentions, owner decisions and last-room thinking expiry |
| Reliable lifecycle | Private intent/work journals, selected stop/resume, fresh reset/export, automatic recovery, startup cancellation transfer, generation-fenced close/report receipts |
| Crash ownership | Linux pidfd/native group guard, forced parent SIGKILL regression and exact private locks; no PID/name scanning |
| Standalone packaging | Native products, shared tool/UI assets, pinned timezone data, licenses/notices, selected native container and shared Knex migration container |

These are owning implementations, not delegating wrappers around Node or C#.
Node is required for shared build/migration/tool assets, not the Rust backend.
Actual implementation differences are listed in `native-layout.md`; EF build
generation, Diesel typed queries and native process APIs remain idiomatic.

## Final-pass corrections

- Separate test CA and non-CA localhost leaf replace the invalid combined
  CA/leaf fixture. Rust verifies TLS normally; no insecure certificate bypass.
- The canonical API rejects unpaired Unicode surrogates and never silently
  replaces them. Node/C# validators and positive/negative fixtures follow the
  same native UTF-8 rule; C#'s internal JSON quoting remains independently tested.
- Private Unix/SSH ownership checks reject dangling/unsafe ancestors and stale
  credentials; short fixture paths obey actual Unix-socket limits.
- Well-formed forbidden paths and unsafe/missing public assets return the same
  non-disclosing 404 as Node/C#. Malformed encodings remain 400. The unchanged
  denial assertions now belong to the shared server contract, so installed and
  container targets both enforce them before a packaging-only regression escapes.
- Native cancellation ownership transfers only after aborting and awaiting the
  admission watcher, so a finished request cannot later kill its admitted engine.
- Completed work does not become a fictitious unfinished turn on shutdown.
  Retained unfinished work can resume without waiting for another incoming message.
- Pi's process guard uses the exact native history identity, not the shared home,
  so independent per-room histories can remain live concurrently. Actual multi-room
  Pi acceptance caught the overly broad lock and verifies the correction.
- Native thread availability/failure observations do not authorize a process
  restart. The owned connection lifetime is authoritative, matching Node/C#.
  This prevents a transient thread status from racing an accepted interruption.
- Steering stays prepared while settling the preceding native input. Only an
  actual submission attempt changes its publication journal to publishing.
  Node, C# and Rust share this ordering and regression; cancellation or failure
  before submission cannot recover a new message against its predecessor's journal.
- Explicit listener stop remains distinguishable from a crash. Transient
  receipt failures reconnect instead of silently killing the control loop.
  Failed initial startup preserves desired intent and schedules recovery;
  failed close remains retryable and cannot authorize a replacement.
- Reset exports current authorized Matrix history. Actual Conduit proves that
  the backward page's end token, reused forward, excludes the already exported
  newest event. No speculative alternate cursor algorithm is introduced.
- Existing plaintext diagnostics have one explicit bounded UTF-8 conversion to
  rotated private records; invalid/concurrently changed originals are preserved.
  Container and server use one shared diagnostic store, matching the other
  implementations instead of racing separate append/retention owners.
- All selected native timezone data uses the shared pinned 2026c owner; release
  distributions retain real dependency LICENSE/NOTICE texts.
- Container fixtures allow the declared stop/removal operations to finish instead
  of killing their operator after ten seconds, before its fifteen-second native
  stop grace. Cleanup remains finite; controlled-clock tests prove both normal
  completion and forced termination at the real deadline. Zero exit and exact
  container removal remain mandatory, and primary failures are no longer masked
  by emergency-cleanup errors.

## Verification

**Sign-off: all eleven phases of the complete current-source four-target gate
pass.** Node, managed C#, actual C# NativeAOT and Rust satisfy the supported product
paths, shared ownership, API/UI and persisted-data contracts within the evidence
scope below. No independently implementable Rust product gap remains.

The final run is `rust-four-target-final-evidence-8`, on 15 October 2026, using
`npm run verify:parity -- /absolute/new-evidence-directory`. All children use the
verified aggregate 16 GiB memory, zero-swap and 2,048-task scope. Internal suites
use all 24 available CPU cores; shared installed targets run concurrently.

| Gate | Final evidence |
| --- | --- |
| Architecture | 19 semantic package pairs, declared dependency directions, negative boundary fixtures and one shared UI/schema owner |
| Node | 895 tests in 194 isolated files; zero failures, cancellations or skips |
| C# | Managed and NativeAOT each pass 798 core, 526 runtime and 28 controller assertions; native dynamic code and reflection JSON are disabled |
| Rust | 250 tests in 131 compiled targets; formatting, warnings-denied all-target Clippy, build and generator drift checks pass |
| Native Matrix | Actual pinned Conduit: C# 490 assertions per mode; Rust authority/enrollment 24/52 |
| Calendars | 2,072 Node/native comparisons for Rust and each C# mode using the pinned timezone owner |
| Persisted state | Six Node/managed/AOT same-file directions; Node/Rust bidirectional data/journal checks, forced-exit locks and four-target same-file restarts |
| Standalone distributions | Independently executable server, fleetd and fleet; managed, NativeAOT and optimized Rust releases, shared assets and actual license notices |
| Installed products | The same 42 cases pass per target: real Codex/Pi, strict settings, source attribution, hard interruption, large-message files, history, reset, stop/resume, local/SSH CLI and React |
| Containers | All 61 shared tests pass: every initial backend, actual Element sign-in/room/CSV downloads, restart/settings persistence, API/SQLite interchange and React at 390/1440 px |
| Knex container | Fresh schema 0 and deployed 13 advance; 17 is idempotent; unsupported 18 is rejected without changing its data |

The final integrated run completes in approximately 32 minutes, including native
publication and container checks. Earlier failures are resolved regressions, not
excluded tests: malformed Unicode fixture expectations, Unix path lengths,
premature steering state, physical/thread lifetime confusion, static-path denial
classification and premature fixture shutdown. A separate concurrent Node plus
three-Rust installed matrix also passes 42 cases per target.

Concise phase logs, per-file timings, shared-target results and the unchanged
upstream diagnostic output are retained locally under the dated Rust analysis
evidence directory. Disposable databases, native test homes and build products
are removed after their final use; authored fixtures and actual user state are
not cleanup candidates. The final staged review also removes an unused workspace
declaration of the daemon application as a dependency. Locked Cargo metadata is
byte-identical before/after that manifest-only cleanup; architecture verification
passes again. No executable dependency, runtime code or data contract changes
after the combined gate.

## Release Scope

This branch is ready for the repository's manual PR workflow against the merged
Node/C# baseline. It does not deploy production, publish public packages, reset
data or alter another worktree. Standalone/native containers are verified release
artifacts, not a claim that GAAP has switched its production backend.

Tests use inert loopback model providers, pinned native engines and actual Conduit
on Linux x64 (Codex 0.162.1 and Pi 1.0.0). They do not certify paid-provider behavior, arbitrary runtime
versions, non-Linux hosts, privileged compromise or impossible no-failure promises.
The merged C# preview/EF NativeAOT diagnostic review remains authoritative and its
warnings are not suppressed or reclassified as Rust defects.

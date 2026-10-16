# Rust integration and verification

Date: 16 October 2026. Version: 0.1.20. Branch: feat/rust-native-20261014.
Main a9c7c42 was merged at e033d42. Only this isolated worktree is modified.
No deployment, registry publication, production reset or other-worktree edit.

## Scope and ownership

- All 48 incoming paths were reviewed; the per-file map covers 801 Node and
  525 C# files and their Rust/shared owners. There are 591 Rust-owned files.
  The inventory reads complete files but is not behavioral certification.
- Rust now consumes the same transferable Docker package, verifies immutable
  archive/image/release identities before touching writers, and owns native
  readiness and bounded exact-container removal. Source-build activation is gone.
- React, REST declarations, agent-tool assets, the Pi extension, SQLite and Knex
  retain their canonical owners. No alternate backend or migration path exists.
- Root packaging composes the upstream Node/C# producer and the Rust producer.
  Product code in all six Node/C# service trees matches origin/main byte for byte.
- The common TLS fixture has a separate test authority and CA:FALSE server leaf.
  Rust still verifies certificate chains, hostnames and signatures normally.

## Verification

Every build/test process group has MemoryMax=16G, MemorySwapMax=0 and
TasksMax=2048. Isolated Rust tests use all 24 available cores.

| Check | Result and boundary |
| --- | --- |
| Architecture and structure | Pass; 19 semantic package pairs, 29 C# project boundaries, no extra UI or runtime migration owner |
| TypeScript type checking | Pass, including the new common operator assertion module |
| Rust full internal run | 265 tests in 136 compiled targets; no ignored cases; warnings-denied Clippy and formatting pass |
| Native integration | 2,072 calendar comparisons, bidirectional same-file SQLite and journal/lock proofs, actual pinned Conduit, Codex 0.163.0 and Pi 1.0.0 with inert providers |
| Release distribution | Linux x64 binaries, actual third-party notices, exact shared tool/UI bytes and standalone README pass |
| Installed-product bank | All 58 assertions pass, including daemon delivery, steering/restart, CLI/SSH, trusted ingress and browser widths 390/1440 |
| Actual container bank | All 32 assertions pass; transferred derivative image import, native health, invalid packages, concurrent/crashed launchers, runtime/migration orphans and foreign ownership |
| Actual Knex containers | Unchanged isolated retry passes schemas 0/13/17 and rejects future 18; the first full-run cleanup failure remains recorded |
| Final isolated parser correction | Rebuilt release passes the five common CLI checks; six focused native checks, formatting, warnings-denied Clippy and type checking pass |
| Root tooling | All 32 tests pass: layout, inventory, native ownership, timezone catalogue, packaging, command output/deadlines, licenses and documentation treatments |
| Current documentation | 65 Markdown guides checked for local links and promotional wording; standalone target guide tests pass |

The full internal/distribution/installed/container evidence precedes the final
isolated operator parser correction. That correction has its own rebuilt native
and shared CLI verification; it does not change HTTP, storage or engine behavior.
The earlier unsuccessful gates remain historical, not substitutes for green runs.

The full gate exits nonzero in its final Knex phase. Its Node-owned operator
exceeds the exact-container removal deadline after the future-schema rejection
and reports "Owned container cleanup is not confirmed", retaining the schema
error as its cause. The strict schema-error assertion therefore fails; it is not
relaxed. Docker subsequently removes that exact test container. A retry uses the
unchanged script, assertions and cleanup budgets, with a freshly built image
from the same Knex sources. Its successful result remains
separate from this unsuccessful full run.

## Remaining work owned by the main session

1. Integrate the concurrent Node/C# SYM-001/002 parser fixes. This fork implements
   the same four/five-digit ASCII port rule and the same shared assertions, but
   does not copy unmerged changes into those excluded product trees. Invalid
   options must not acquire the lock, call Docker or change configuration/login.
2. Extend the canonical Node-owned containerSourceDigest input list to include
   root Cargo.toml, Cargo.lock and rust-toolchain.toml. Rust verifies those bytes
   remain unchanged during its build; archive hashes and exact image IDs verify
   the output. That does not correct the source-fingerprint omission itself.
3. Reconcile the earlier Node/C# findings individually against current main;
   the preserved proposal is not an instruction to apply it wholesale. Main
   fixed the shared 180-second operator cleanup allowance and pinned IANA
   producer. This branch fixed the common external TLS fixture; old language-local
   TLS fixtures and the other listed owner findings are separate work.
4. Run the final four-target verify:parity matrix after those owner fixes merge.
   This run verifies Rust and its shared contracts, not every possible combination
   of Node, managed C#, NativeAOT C# and Rust executables or images.
5. Investigate the observed Node-owned migration-container cleanup deadline under
   disk load. The exact container eventually disappeared, but the deadline failure
   is real and the strict gate must remain. Preserve both the primary schema error
   and cleanup failure rather than changing the test to accept unconfirmed cleanup.

No paid-provider, all-platform, arbitrary escaped-subprocess, sustained-load or
zero-failure guarantee is claimed. Native parent-death differences retain their
explicit documented scopes.

## Cleanup and handoff

After the active checks finish, remove all worktree-local test/native homes,
temporary databases and credentials, compiled outputs, package staging,
dependencies and build caches. Preserve source, Git, authored inputs, concise
verification summaries and saved user/native histories. No global Docker prune
or other-worktree cleanup is authorized by this worktree-local request.

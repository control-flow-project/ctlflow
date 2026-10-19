# Rust integration quality gate

Review: 16–17 October 2026. Branch: `feat/rust-native-20261014`. Version: 0.1.20.
Baseline: integrated main `7378d12`. No deployment or publication is performed.

## Status

Full attempt 18 passes every phase on the same frozen source. Node, managed C#,
NativeAOT C# and Rust pass the common installed-product and container banks.
The actual shared Knex migration container passes initialization, upgrade and
idempotence checks and rejects an unsupported future schema.

Verified source digest:
`8d2139740860751e2432c0eba263cfeedba7fe37d9694a31078c192ff9d7fcb8`.
The complete command is `npm run verify:parity -- /absolute/new-evidence-directory`;
the run's local evidence is `.analysis/20261016-rust-quality-gate/full-18`.
Earlier failed or interrupted attempts are retained separately, not combined
with retries to manufacture a passing full run.

## Symmetry

| Area | Current ownership and verification |
| --- | --- |
| Products | Crossfire server, fleetd daemon and Fleet CLI exist in Node, C# and Rust |
| Modules | Nineteen corresponding package responsibilities; pure domain boundaries and application reach-through checks apply to each implementation |
| UI and APIs | One React application, canonical REST declarations, shared wire schemas and one installed-product assertion bank; no backend-specific assertion skips |
| Database | One Knex migration owner and common SQLite schema; Tinqer, EF and Diesel implement queries, not competing schemas or startup migration paths |
| Runtime | Same Codex/Pi integration ports, attribution, steering, receipt, history and lifecycle contracts; fleetd alone owns native execution |
| Packaging | Node, managed C#, NativeAOT C# and Rust distributions and explicitly selected Docker packages; no backend delegation or source-built activation fallback |
| Boundaries | Strict UTF-8/Unicode, wire-unit-safe truncation, atomic telemetry, bound SQLite LIKE queries and explicit transport limits |
| Verification | The same installed API/UI/native/CLI assertions run against all four targets; container fixtures share one finite resource slice and retain sequential scenarios within each isolated target |

The inventory covers 804 Node files, 526 C# files and 592 Rust files. It includes
source, tests, manifests, generated metadata and build inputs. File association
does not establish behavior. Language naming, ORM compilation and native process
primitives remain target-specific; no artificial counterpart directories or
duplicate shared assets are added to imitate another language's toolchain.

- [File audit](../architecture/native-file-audit.md)
- [File ownership map](../architecture/native-file-map.tsv)
- [Native layout and target differences](../architecture/native-layout.md)

## Corrections

RQ-001 through RQ-016 and their owning corrections are documented in the
integration review. Confirmed Node/C# defects are included in this PR; the earlier
fork-only exclusion no longer applies. Superseded helper owners and guards are
removed rather than retained as compatibility layers.

- [Corrections and issue IDs](20261017-rust-integration-review.md)
- [Executable scenario inventory](../../services/crossfire/tests/contracts/README.md)
- [Reproduction commands and resource model](shared-contracts.md)

## Final verification

All eleven phases pass. The phase durations total 97 minutes 22 seconds on the
verification host; this includes container construction and recovery, not just
application request time.

| Gate | Result |
| --- | --- |
| Architecture | Layout, dependency graphs, generated metadata/assets, inventory and documentation checks pass |
| Node | 931 tests in 208 isolated files, 24 workers; strict typecheck, product/UI build, Codex and Pi selected |
| Managed C# | 5,241 core assertions, 537 native runtime assertions, 28 controller assertions and 2,072 calendar comparisons |
| NativeAOT C# | Same assertion/comparison counts in actual native executables; reflection JSON disabled |
| Rust | 269 tests in 137 compiled targets; formatting and warnings-denied workspace Clippy pass |
| State | Bidirectional SQLite/journal/lock and explicit historical-schema conversion/rollback checks pass |
| Distributions | All three native distribution modes build |
| Installed products | All 63 shared tests pass on each of Node, managed C#, NativeAOT C# and Rust, including actual browser checks at 390px/1440px |
| Containers | 32 shared tests pass on each of the four targets; actual Element/media, API, same-file data, responsive UI, transferred archives, exclusive ownership, killed launchers and running/exited migration orphans |
| Operator/backend selection | All 16 unique ordered pairs pass once in the explicit selection bank; image-owned entrypoint/readiness and exact runtime identities are checked |
| Actual Knex container | Schema 0 initializes, 13 upgrades, 17 is idempotent, 18 is rejected; current stores pass integrity and foreign-key checks |

| Phase | Seconds |
| --- | ---: |
| Architecture | 9.599 |
| Node | 91.060 |
| C# | 381.937 |
| Rust | 30.209 |
| Managed distribution | 58.800 |
| NativeAOT distribution | 157.583 |
| Rust distribution | 49.876 |
| Matrix preparation | 0.038 |
| Installed contracts | 181.660 |
| Container construction and contracts | 4,804.130 |
| Actual migration container | 77.311 |

Verification runs in a process-group scope with 16 GiB memory, zero swap and
2,048 tasks. Docker build/runtime/test descendants have their own verified finite
aggregate slice with the same limits. Per-file timings, phase outcomes and
bounded diagnostic logs are retained locally; recreated fixtures are not release
artifacts.

Scenario and one-hour target deadlines remain unchanged. Container lifecycle
mutations share the command adapter's finite policy, with one 120-second removal
deadline covering stop, metadata and deletion. The graceful-stop allowance stays
15 seconds. The launcher teardown guard covers possible in-flight creation,
removal and stream disposal; it is not an extra allowance to complete a model
task or to turn a failed scenario into a pass.

## Failed and interrupted attempts

| Attempt | Diagnosis and correction |
| --- | --- |
| 1 | Installation fingerprint fixture omitted newly required root Cargo inputs; include the canonical inputs |
| 2 | Seven real Unix-socket path failures and one TLS self-import; use one short private coordinator fixture root and direct helper import |
| 3 | Complete Node bank passes; a new C# test lacks its kernel namespace import; correct that import |
| 4 | Listener setup advances controlled maintenance time while waiting for native I/O; separate observation-only waiting and prove it does not run scheduled callbacks |
| 5 | Rust observation test counts UTF-16 units at a UTF-8 byte boundary; assert exact 1,000-emoji/4,000-byte content and wire admission in every implementation |
| 6 | Installed Rust history browsing races query-status maintenance; use an atomic synchronous state check without claiming an active query slot; preserve real query/publication exclusion |
| 7 | All internal/distribution/installed gates pass and all images build; deliberately cancel the serial container coordinator after 61 minutes, with 25 tests passing and one cancellation; run independent fixtures concurrently without changing assertions or any timeout |
| 8 | Internal/distribution/installed gates pass again; sharing one Node event loop lets synchronous Docker calls block another target's browser and fixture heartbeat; preserve both browser failures and replace in-process concurrency with the shared isolated-process runner |
| 9 | Internal/distribution/installed gates and all four container UI/API banks pass; derivative setup snapshots an unused container just to add a label and hits its 30-second limit; replace that preparation with a label-only image build, retain exact import/readiness assertions and preserve the failed/interrupted record |
| 10 | Internal/distribution/installed and container UI/API banks pass; concurrent image construction still inherits the metadata-probe timeout; assign construction the existing five-minute artifact budget already used by export/verification; metadata probes, behavioral assertions and product/target/overall deadlines remain unchanged |
| 11 | Node/Rust pass all 32 container tests each; C# reaches final recovery checks but exceeds one hour without a leaf assertion failure; remove repeated Cartesian enumeration across workers while retaining every one of the 16 unique ordered operator/backend pairs and all existing deadlines |
| 12 | Internal/distribution/installed banks pass; a Rust operator's runtime creation hits the generic 30-second capture limit after migrations, leaving Docker's container in created state. The failed leaf and subsequent unavailable-API failures are retained; the remaining bank is stopped. The command adapter now distinguishes filesystem mutation from metadata and owns the finite policy in all three implementations, rather than allowing caller-specific deadlines. High measured host I/O pressure is contemporaneous evidence, not proof of Docker's internal cause |
| 13 | Architecture and 929 Node tests pass; deliberately stop during C# verification after an independent, barrier-controlled reproduction shows the Node Docker pipe replaces one fragmented Unicode scalar with three replacement characters. Complete RQ-002 at that command boundary with incremental strict decoding, exact raw-byte admission and malformed/truncated/oversized-output regressions; C#/Rust already have strict native collectors |
| 14 | Architecture passes; one native Codex acceptance assertion reads an independent observer's notification list before its event arrives, although receipt and provider-input checks have completed. Wait for that specific notification using the existing bounded observation helper, then retain the exact count of one and all receipt/input assertions. No timeout or product behavior changes |
| 15 | The native Codex bank passes; sender-lookup acceptance sees a second resolution while using real maintenance time. Its pure idle/blocked/authorized scenario now uses the existing controlled clock and explicit completed-poll barriers, keeping zero blocked lookups, exact authorized metadata, one authorized lookup and all I/O bounds unchanged |
| 16 | All current internal/distribution banks and 63 installed tests on every target pass. Container verification fails before creating its resource slice because the Docker daemon prerequisite probe exceeds its existing 10-second bound. Independent follow-up default/explicit-rootless probes succeed in 43–53 ms. Retain the failed run and repeat the entire unchanged-source gate; no deadline increase, daemon restart or host configuration change |
| 17 | Node and both C# modes pass all 32 container tests each. Rust passes API/UI, package transfer, every operator/backend pair, corrupted-package and killed-launcher checks, then fails migration-orphan reconciliation when Docker stop hits the metadata deadline. Classify stop as a lifecycle mutation and remove the competing top-level stop path in every implementation. One removal deadline owns stop, metadata and deletion. The launcher guard covers creation plus removal and stream teardown; all scenario/target/bank deadlines and assertions remain unchanged |

The first focused Node invocation used nonexistent built-test paths and did not
select the intended product files. It is not counted as passing evidence. The
corrected invocation checks paths before running the actual files. No full
attempt is reported green by combining an earlier partial run with a later
retry of only its failed assertion.

## Dependency security

Only the rustls lock record/checksum changes, from 0.23.45 to 0.23.46. It fixes
four RustSec advisories; no audit suppression, TLS relaxation or unrelated
dependency update is introduced. RustSec reports zero advisories and zero
warnings across 263 lock records with database commit
`479c888ce4401313bca61ba4aba2d0f6244c4a09`. The npm audit reports zero
vulnerabilities across 180 dependencies; its lockfile and release-age policy are
unchanged. These are dependency findings, not evidence of compromise or proof
that every advisory was remotely reachable through Crossfire.

- [RUSTSEC-2026-0346](https://rustsec.org/advisories/RUSTSEC-2026-0346.html)
- [RUSTSEC-2026-0347](https://rustsec.org/advisories/RUSTSEC-2026-0347.html)
- [RUSTSEC-2026-0348](https://rustsec.org/advisories/RUSTSEC-2026-0348.html)
- [RUSTSEC-2026-0349](https://rustsec.org/advisories/RUSTSEC-2026-0349.html)

## Cleanup

After verification, 90 inactive generated paths were removed from this worktree:
test fixtures/databases, installed dependencies, distribution output, Rust
targets and C# bin/obj trees. Their allocated size before removal was 16.4 GiB.
Ownership, exact path identity, tracked-file protection and process references
were checked before deletion. Concise timing, failure and result records remain.

Docker cleanup removed 312 exact review-owned image IDs without force or prune.
All 234 baseline images and all 14 existing containers were verified present
afterward. Sixty shared parent images were retained. Other worktrees, global
caches, authored source, credentials and real histories were not selected.

## Limits

The selected native/container platform is Linux x64. Actual pinned Codex/Pi
engines use inert providers; these checks do not establish paid-model quality,
sustained-load capacity, unselected operating systems or every power-loss
instruction boundary. The .NET 11/EF dependencies are previews; upstream
NativeAOT trimming/dynamic-code diagnostics remain visible, not suppressed.

Rust's Linux guard observes the exact controller lifetime and terminates its
owned native process group. Node/C# can retain a native writer after controller
SIGKILL and refuse a competing writer through the native lock. A subprocess
deliberately escaping its process group is outside the guard's protection. These
are documented native target differences, not universal crash guarantees.

Other repositories, production state, credentials and real user/agent histories
are unchanged. This branch is prepared for manual PR creation, not automatically
merged, published or deployed.

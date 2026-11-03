# Lazy fleet startup — 3 November 2026

Fleet startup, controller recovery and server reconnection restore listeners and
retained native histories without submitting synthetic continuation turns.
Repeated Start is idempotent. Native execution waits for genuine eligible input;
an interrupted historical task does not itself authorize another model turn.
Explicit enrollment/reset may initialize a native identity without inference.

Node, C# managed/NativeAOT and Rust implement the same contract. The removed
restart-task checkpoint readers, writers and continuation prompts have no
replacement compatibility path. Pending real-message receipts and publication
reconciliation remain separate from the removed synthetic task reminders.
Failed native cleanup blocks replacement rather than permitting a competing
generation, including when startup returns an unexpected history identity.

## Current source verification

The functional source checkpoint is `4448daea`. These are local verification
results, not deployment or live-provider certification. Native integration uses
actual Codex and Pi executables with controlled provider fixtures.

| Check | Result |
| --- | --- |
| Node suite | 949 tests, 211 isolated files; zero failures or skips; 96.380 seconds |
| C# managed and NativeAOT | Full verification passed; 1,874 controller assertions and 584 runtime assertions per build selection |
| Rust | 277 tests across 137 test binaries; formatting and Clippy passed |
| Architecture | Passed, including structure, native layout and current file map |
| Shared installed contracts | 119 tests per target on Node, C# managed, C# NativeAOT and Rust; zero failures or skips |
| Shared container contracts | 33 tests per target on all four targets; zero failures or skips; 210.652 seconds for the complete container gate |
| Knex migration container | Fresh initialization and repeated invocation passed |

The lifecycle tests include a 100-instance restoration case, metadata-only
inspection, genuine-input wakeup, repeated controller crashes, server outage,
retained history, explicit stopped selections and failed-cleanup fencing. The
shared installed contracts exercise both native runtimes on every target and
assert provider request counts around startup, inspection and recovery.

Tests ran with finite aggregate process-group limits: 16 GiB memory, no swap and
4,096 tasks for the main verification runs. Earlier resource and fixture failures
remain failures: one run exhausted its then-2,048-task limit; another architecture
attempt did not acknowledge the native trust-dialog selection key. The complete
current runs passed after increasing the finite task budget and rerunning the
unchanged native fixture respectively. The input-delivery cause is unproved.

The first container attempt built its images but could not invoke Compose because
the local Docker CLI lacked that plugin. A privately installed Compose plugin
allowed the complete unchanged container bank to pass. The default HDD-backed
Docker store was not reset or repaired; checks used an isolated disposable daemon.
Existing NativeAOT diagnostics remain visible in build logs.

## Performance

Two complete measurements failed the existing strict comparison gate. Every
request succeeded; different comparisons failed between measurements:

| Measurement | Failing comparison | Measured ratio to Node | Required |
| --- | --- | --- | --- |
| First | Managed saved-observation throughput | 0.867857 | At least 0.95 |
| Second | Managed session throughput | 0.947514 | At least 1.0 |
| Second | NativeAOT saved-observation p95 | 1.047429 | At most 1.0 |

The first measurement passed 23 of 24 comparisons; the second passed 22 of 24.
No comparison threshold, sample count, runtime selection or assertion was changed.
The server implementations and their database read paths are unchanged by this
branch. Variation alone does not establish its cause.

The final measurement, after the other verification jobs finished, passed all
24 comparisons: 11,200 measured requests, zero request failures, 197.134 seconds.
It completed at 09:10:07 UTC. Managed saved-observation ratios were 1.072461 for
median latency, 1.031812 for p95 and 0.980330 for throughput, within that workload's
explicit approved limits. NativeAOT saved-observation ratios were 0.936922,
0.899606 and 1.135773 respectively, within its strict limits. No source or gate
changes separated these measurements. The final pass does not explain the two
earlier failures or establish repeatability under arbitrary host contention.

## Operational boundary

No package publication, deployment, production inference or collection was
performed. Both production fleets remain stopped. This branch is PR preparation;
registry publication and coordinated deployment are separate work. Local package
builds do not prove a new immutable release has been published.

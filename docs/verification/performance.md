# crossfire performance verification

Managed .NET, NativeAOT and Rust run the same HTTP workload against one
populated management database. A server health response is not a management UI
latency measurement. Runtime adapters and paid model quality are separate checks.

NativeAOT is the measured reference. The suite fails if a selected target is
missing, any request fails, median/p95 latency exceeds the reference or throughput
falls below it. The same limits apply to all targets. It produces an offline HTML
report and machine-readable samples, including failed attempts and actual source
and resource limits. Historical reports retain their original comparisons;
they do not certify the current source.

- [Command, workload and comparison method](../../services/crossfire/tests/performance/README.md)
- [Executable matrix and contract verification](shared-contracts.md)

Production diagnosis should separately measure connection establishment, response
waiting and complete authenticated page rendering. Same-origin fetch does not
make a database lock or a slow status query fast. SQLite WAL permits management
read snapshots alongside heartbeat commits; full synchronous durability remains
enabled. Only SQLite's backup API or a quiescent complete-state backup captures
committed WAL reliably.

# crossfire performance verification

Managed .NET, NativeAOT and Rust run the same HTTP workload against one
populated management database. A server health response is not a management UI
latency measurement. Runtime adapters and paid model quality are separate checks.

The suite requires every configured target, round and workload to complete with
zero request failures. Latency percentiles and throughput are recorded without
speed thresholds or comparisons against another target or an earlier release.
The offline HTML and JSON contain source provenance, resource limits, samples
and failures. Historical reports retain their original comparisons and verdicts;
they do not certify current source.

- [Command, workload and measurement method](../../services/crossfire/tests/performance/README.md)
- [Executable matrix and contract verification](shared-contracts.md)

Production diagnosis should separately measure connection establishment, response
waiting and complete authenticated page rendering. Same-origin fetch does not
make a database lock or a slow status query fast. SQLite WAL permits management
read snapshots alongside heartbeat commits; full synchronous durability remains
enabled. Only SQLite's backup API or a quiescent complete-state backup captures
committed WAL reliably.

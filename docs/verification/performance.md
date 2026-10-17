# crossfire performance verification

Node, .NET managed, NativeAOT and Rust run the same HTTP workload against one
populated management database. A server health response is not a management UI
latency measurement. Runtime adapters and paid model quality are separate checks.

The suite fails when any selected runtime is missing, any request fails, or a
workload falls below the measured Node baseline. It produces an offline HTML
report and machine-readable samples, including failed attempts. Source and
resource limits remain visible in the report.

- [Command, workload and comparison method](../../services/crossfire/tests/performance/README.md)
- [Executable matrix and contract verification](shared-contracts.md)

Production diagnosis should separately measure connection establishment, response
waiting and complete authenticated page rendering. Same-origin fetch does not
make a database lock or a slow status query fast. SQLite WAL permits management
read snapshots alongside heartbeat commits; full synchronous durability remains
enabled. Only SQLite's backup API or a quiescent complete-state backup captures
committed WAL reliably.

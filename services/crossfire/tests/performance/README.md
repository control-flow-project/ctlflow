# crossfire server performance

Run from a finite process-group resource scope after publishing current Node,
.NET managed/NativeAOT and Rust executables:

```sh
npm run verify:performance -- /absolute/implementation-matrix.json /absolute/new-report-directory
```

Use the same implementation matrix as the shared contract suite. All four targets
are required. The command builds the shared fixtures, verifies report rendering,
and uses the actual pinned Matrix server. There are no model calls or production
connections. `verify:parity` includes this suite before container acceptance.

The fixture has 50 agents, 50,000 closed listener histories and 50,000 saved runtime
observations in one Knex-prepared SQLite file. Synthetic historical agents are
database load fixtures, not proof of live native-agent execution. The same file
and native human authentication survive each backend restart.

Each target runs once in every position in the rotated order. Each sequential
workload has 20 successful warm-up requests and 100 measured requests per round:
session, policy, paged agent directory, fleet directory and saved observations.
The concurrent workload has seven directory readers and one controller writer,
each sending 25 requests. Controller generations close explicitly between runs.

Transport uses verified loopback TLS and persistent connections through the shared
proxy. Response collection, JSON decoding and wire-contract checks are included.
Every attempted measured request retains its latency; an error is never removed
from percentiles. Setup/warm-up failures stop measurement and fail the run.

Nearest-rank p50/p95/p99 and requests/second are calculated per round. The median
round statistic is compared to Node for the same workload. Every non-Node target
must have zero failures, p50 no higher than Node, and throughput no lower.
p95 must not exceed the recorded per-comparison limit. The owner approved one
exception on 2026-10-18: managed .NET saved-observation p95 may reach 1.30 times
Node. Every other p95 comparison remains at 1.00 times Node. The report labels
exception use and retains earlier failed attempts. There is no hidden tolerance,
runtime exclusion, best-round selection or claim that results on one machine
establish arbitrary production capacity. Keep other builds and benchmark runs
off the machine while measuring.

`results.json` contains samples, failures, resource ceilings and source provenance.
`report.html` is an offline, responsive report with comparison tables and median
latency bars. It contains no scripts or external resources. Reports are private
local verification output, not source files to commit. The fixture is disposed;
retain the compact report rather than its rebuilt database.

# Native-only release verification — 4 November 2026

Build source: `50347261a3c4fc7e5ffd2dcf4f530b76f144acab`.
Documentation and timing-run source: `928b36b9d0076899e98225f8cec0d5399856b9ac`.
Both commits describe version `0.1.26`; the latter adds the publication inventory.
The build-source digest is
`48ca3827203b2f11e46b1c829a937876e7334eebbd413e8bad622692e9012009`.

## Verification

| Bank | Managed C# | NativeAOT | Rust |
| --- | --- | --- | --- |
| Shared installed products, actual Codex and Pi with controlled providers | 120 passed; 418.2 s | 120 passed; 344.9 s | 120 passed; 603.6 s |
| Shared container API, Element, React, same-file database and Compose contracts | 33 passed; 163.9 s | 33 passed; 154.4 s | 33 passed; 152.3 s |

No assertions failed, skipped, were cancelled or remained unfinished. Target
workers overlap; their durations must not be added as elapsed wall time.
Installed workers shared a 12 GiB / zero swap / 2048-task aggregate; container
workers and their containers shared a separate 8 GiB / zero swap / 2048-task
aggregate. The shared Knex image passed actual initialization and repeat runs.

The current C# managed and NativeAOT bank passed 5251 core assertions, 84
storage/authentication assertions, 1874 controller assertions and 584 native
Codex/Pi runtime assertions per mode, along with calendar and database checks.
The patched SDK is `11.0.100-rc.3.26522.148`; EF/SQLite packages are
`11.0.0-rc.3.26522.148`. Earlier RC2 restores failed NU1903 for the Brotli decoder
advisory GHSA-p3jp-9v83-76w9. The pins were upgraded; audit and warnings-as-errors
were not disabled. Existing EF/trimming/AOT diagnostics remain visible.
Rust source was unchanged by that dependency patch; its existing native build
was reused and exercised by both complete current shared suites.

## Absolute HTTP measurements

The final clean-source RC3 run completed in 85.1 seconds. It includes all three
targets, three rounds and six workloads: 54 measurement groups, 18 summaries,
6300 measured requests and zero failures. These are local fixed-fixture
measurements, not production or paid-provider certification. There is no
comparative performance gate, speed threshold or hidden tolerance.

The fixture contains 50 agents, 50000 listener histories and 50000 runtime
observations. These summaries combine the three rounds; throughput is reported
by the benchmark's existing aggregation, not added across overlapping workers.

| Target | Workload | Requests | p50 ms | p95 ms | p99 ms | Requests/s |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| csharp-managed | Session | 300 | 0.993 | 1.168 | 3.286 | 905.5 |
| csharp-managed | Policy | 300 | 1.212 | 1.372 | 1.469 | 803.5 |
| csharp-managed | Agent directory · 50,000 histories | 300 | 10.935 | 12.499 | 13.397 | 89.4 |
| csharp-managed | Fleet directory · 50 agents | 300 | 8.700 | 9.825 | 10.224 | 112.7 |
| csharp-managed | Saved runtime observations | 300 | 1.575 | 1.894 | 2.377 | 603.7 |
| csharp-managed | Concurrent UI reads + controller heartbeats | 600 | 15.020 | 152.035 | 152.354 | 58.6 |
| csharp-nativeaot | Session | 300 | 0.866 | 0.990 | 1.064 | 1126.7 |
| csharp-nativeaot | Policy | 300 | 1.044 | 1.176 | 1.251 | 930.0 |
| csharp-nativeaot | Agent directory · 50,000 histories | 300 | 10.118 | 11.602 | 12.990 | 95.7 |
| csharp-nativeaot | Fleet directory · 50 agents | 300 | 7.986 | 9.021 | 9.519 | 121.7 |
| csharp-nativeaot | Saved runtime observations | 300 | 1.373 | 1.640 | 2.434 | 688.4 |
| csharp-nativeaot | Concurrent UI reads + controller heartbeats | 600 | 14.122 | 151.710 | 152.062 | 68.3 |
| rust | Session | 300 | 0.395 | 0.468 | 0.489 | 2354.8 |
| rust | Policy | 300 | 0.426 | 0.515 | 0.554 | 2110.2 |
| rust | Agent directory · 50,000 histories | 300 | 21.424 | 22.696 | 23.441 | 46.2 |
| rust | Fleet directory · 50 agents | 300 | 24.160 | 25.239 | 27.123 | 40.9 |
| rust | Saved runtime observations | 300 | 0.457 | 0.545 | 0.585 | 2023.4 |
| rust | Concurrent UI reads + controller heartbeats | 600 | 104.727 | 197.584 | 2394.973 | 48.4 |

## Release surfaces

All three runtime images and the shared Knex image were published and pulled by
immutable digest. The [release inventory](../distributions/releases/0.1.26.md)
records exact digests, private registry access and local native archive hashes.
GitHub native archive publication remains blocked by missing repository-release
credential scope; no successful public archive download is claimed.

Branded Bad Bets and GAAP packages passed their native Element desktop/mobile
suites. Bad Bets additionally passed all 40 installer tests against the actual
patched NativeAOT archive. Live server and fleet activation receipts belong to
the corresponding site/fleet repositories; these test results alone do not
establish deployment. No paid provider inference was used for these test banks.

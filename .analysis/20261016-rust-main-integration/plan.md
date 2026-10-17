# Rust integration of main 7378d12

Scope: this worktree and feature branch only. Node/C# implementations remain
byte-identical to main. Knex, React and external assertions retain shared owners.
No deployment, registry publication, subagents or automatic PR creation.

| Step | State | Required evidence |
| --- | --- | --- |
| Merge main and inspect incoming files | Complete | a9c7c42 merged at e033d42; all 48 incoming paths reviewed and mapped |
| Port container package and lifecycle contract | Complete | Native archive/manifest/image verification, readiness, bounded removal; obsolete options rejected; focused regressions pass |
| Align shared verification and factual documentation | Complete | Root four-backend packaging, same external bank, corrected shared TLS authority/leaf fixture, common IANA producer and refreshed map |
| Align the shared SYM parser contract | Complete | Rebuilt Rust release passes the same five shared CLI checks; six focused native checks and warnings-denied Clippy pass; no lock or Docker on invalid arguments |
| Verify Rust and cross-backend interchange | Complete | Internal, distribution, 58 installed and 32 actual-container assertions pass; unchanged Knex retry passes; original cleanup failure stays recorded |
| Merge the latest main | Complete | 7378d12 merged at 9e90bdf; all ten SYM-001/002/003 paths reviewed; no Rust runtime or shared corpus delta |
| Verify the final merge | Complete | Typecheck/build, 32 root, four Node unit and five common CLI checks pass; protected trees/dependencies match latest main and Rust runtime/corpus match verified checkpoint |
| Review, clean and push | Complete | 10.75 GiB reclaimed; zero generated artifacts; concise evidence and timings retained; latest main is an ancestor of this same feature branch, prepared for its final push |

Build/test process groups: MemoryMax=16G, MemorySwapMax=0, TasksMax=2048.
All existing shared assertion requirements remain; no fixtures or security gates
are weakened to compensate for excluded-owner failures.

The parser follow-up was verified while the container gate finished against its
already-built immutable binaries/images. No consumed binary or compiled fixture
was replaced. Its focused evidence remains distinct from the earlier full run.

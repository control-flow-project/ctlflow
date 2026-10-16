# Rust-only verification and handover

Date: 16 October 2026. Main reference: `09fec7c`.
Working branch: `feat/rust-native-20261014`.

## Scope and source

- Node/C# product source, tests, generated assets and Dockerfiles match main.
- The C# solution/publisher and root/web TypeScript settings also match main.
- Rust product code, its build/verification wiring and documentation are retained.
- Inventory: 790 Node files, 523 C# files and 585 Rust files; 19 semantic package pairs.
- Knex owns all schema creation/forward migrations; SQLite and React stay shared.
- No deployment, package publication, production reset or peer-worktree edit.

## Results

Every build/test uses a verified 16 GiB, zero-swap, 2,048-task process-group limit.
The native test runner uses all 24 available cores and retains per-file timings.

| Check | Final result |
| --- | --- |
| Architecture, dependency ownership and TypeScript checks | Pass |
| Cargo formatting and warnings-denied Clippy | Pass |
| Rust tests | 260 pass across 133 compiled targets; none ignored |
| Calendar differential checks | 2,072 Node/Rust cases pass with pinned IANA data despite different host tzdata |
| SQLite interchange | Node to Rust and Rust to Node pass on the same schema/data |
| Native receipt journals and cross-process SQLite locks | Nine assertions pass in both directions |
| Actual Conduit authority and enrollment | Pass |
| Actual Codex/Pi adapter checks | Pass with inert providers, not paid-model certification |
| Linux x64 Rust release distribution | Pass; exact guide, shared tool/web bytes, timezone data and notices |
| Installed shared product bank | Not green: unchanged Node fixture uses CA:TRUE as its HTTPS leaf; rustls refuses native enrollment/CLI setup |
| Actual Rust container shared bank | All 29 pass; none skipped/cancelled |
| Container HTTP/API coverage | Every declared operation has a successful wire-validated scenario |
| Element/media and React | Actual authenticated CSV download plus negative access; 390px/1440px checks pass |
| Container ownership/recovery | Concurrent operator, killed launcher, running/exited migration orphan and foreign ownership cases pass |
| Actual Knex container | Schemas 0/13/17 pass; future 18 rejected without mutation |
| Root audit/documentation/tooling regressions | 28 pass; 63 current Markdown files checked |

The first container run found this branch's new test fixture reusing an expired
controller generation after a slow container restart. Its lifecycle now closes
the old controller/listener and registers fresh generations before re-reporting
the same native session. All expiry, scope, ordering and coverage assertions
remain. The rerun is green; the earlier result is retained as diagnosis only.

## Remaining main-session work

Fix the excluded shared TLS fixture at its existing Node owner: separate CA and
CA:FALSE/serverAuth leaf, valid SAN/chain, exact fixture trust. Do not disable
certificate or hostname verification, alter Rust trust behavior or bypass the
installed contract bank. Then rerun `npm run verify:rust -- /absolute/new-evidence`
and the four-target `verify:parity` coordinator after other owners' fixes.

The full Rust release gate currently exits nonzero on that fixture. This report
is a scoped implementation handover, not a claim that all product tests or final
cross-target release gates are green. Node/C# findings and proposed changes are
in this directory's README and compressed patch; the main session owns them.

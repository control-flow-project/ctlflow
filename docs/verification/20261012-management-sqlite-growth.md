# Management SQLite growth — 12 October 2026

## Scope and cause

This is a Crossfire server/storage correction, based on main `8842dd8` and
prepared on `fix/management-sqlite-growth-20261012`. No Bad Bets source or
deployment is inspected or changed. GAAP, Toolsmith, production data, fleet
intent, identities and native histories are unchanged.

The SQLite opener applied `max_page_count = floor(256 MiB / page_size)` on
every connection. At the normal 4096-byte page size that is 65536 pages. A full
store with no reusable pages cannot allocate pages for another listener run,
regardless of additional available filesystem space. The existing storage test
explicitly enforced that artificial ceiling.

The fix removes the override and its unused page-size calculation. It uses the
supported SQLite engine's ordinary capacity, not another arbitrary application
ceiling or configuration feature. Private ownership/mode checks, foreign keys,
busy timeout, DELETE journaling, schema 16, normalized Tinqer repositories and
retention remain unchanged.

The pinned native driver uses SQLite 3.53.4. A real private-file probe confirms
its default is 4,294,967,294 pages and that reopening restores the default after
a connection-local 65536-page override. There is no persistent page-limit
metadata to migrate. Native engine and filesystem limits remain applicable.

The existing shared SQLite error boundary now returns an unavailable Result
for SQLITE_FULL. The complete unit-of-work invokes that same boundary, including
transaction preparation/execution, rather than introducing another classifier.
Expected failures preserve native rollback. Unexpected errors still propagate.
There is no automatic retry wrapper, data cleanup, alternate schema or new API.

## Regression evidence

The first three regressions fail against the original implementation; both
transaction-boundary regressions fail before the owning boundary correction.
All five new regressions pass on final source:

- Native capacity matches the same driver for in-memory storage and all eight
  supported page sizes, from 512 through 65,536 bytes; foreign keys and DELETE
  journaling remain enabled.
- A real management store is filled to exactly 268,435,456 bytes with zero free
  pages under the former connection limit. After normal reopen, the ordinary
  listener-report use case registers another authenticated, controller-bound
  run and the same file grows beyond the former ceiling.
- Existing principal, policy, listener run and committed audit bytes remain
  identical. Another reopen accepts another write; integrity and foreign keys
  pass. The fixture uses large synthetic audit text for bounded, quick allocation;
  this is not evidence of what filled any excluded production database.
- An actually exhausted small SQLite store returns unavailable, rolls back
  the earlier principal update and leaves no partial audit record. Increasing
  available fixture capacity permits the identical operation to commit once.
- Controlled transaction-level capacity faults at startup and after successful
  callback writes return the same unavailable Result; the latter uses actual
  native SQLite rollback. These injected boundary cases are not a claim of
  physically exhausting a production filesystem or every possible COMMIT failure.

The two existing private-store tests and canonical schema/rollback test also
pass. Capacity fixture loops are bounded and their databases/directories are
disposed in reverse acquisition order.

## Final verification

| Gate | Result |
| --- | --- |
| Typecheck and build | Pass for all three services. |
| Storage/schema tests | Eight pass, including all five new regressions. |
| Full tests | **Not green:** 831 tests, 828 pass, 3 fail; 181 files, 24 workers, 83,924 ms. Both implemented runtimes remain included. |
| Architecture | All 33 checks pass; service ownership, normalized storage, import directions and bounded native tests remain enforced. |
| Installation | All four checks pass. |
| Container acceptance | Pass: `crossfire-runtime:e3a320ce2e47d06af730`, evidence `container-verification-Z1N2rS`; real Element/native routes, authenticated attachment download, artifacts, shutdown and persisted rooms verified. |
| Dependencies and packages | Lockfile, all external records, package versions and public client artifact release/bytes unchanged. No package is published. |
| Git whitespace | Pass. |
| Aggregate resource limits | Final tests/gates use verified 24 GiB memory, zero swap and 8,192 tasks; Docker descendants share the finite test slice. Focused/baseline probes use verified 8 GiB/no-swap/1,024-task limits. |

The three full-test failures are in the unchanged native Codex tests:
`services/crossfire/node/scripts/native-tests/codex.test.ts` (two failures) and
`services/crossfire/node/tests/codex-process-restart.test.ts` (one failure).
They also reproduce using a clean detached checkout of exact main `8842dd8`,
its own compiled sources/package resolutions and the same installed Codex 0.162.1.
The baseline tests cover queued-input/replay and cancellation assumptions. This
establishes pre-existing failures, not a complete diagnosis or a universal native
adapter certification. No runtime source, native assertion, timeout, selection
or gate is changed or suppressed. The disposable baseline checkout is removed;
its failure logs are retained. **The overall product test gate remains non-green.**

The earlier 829-test run likewise records three native failures and is retained.
The final 831-test run includes the two later transaction-boundary regressions.
Architecture, installation and container checks are executed independently after
the non-green full test command; they do not erase or override its failure.

## Downstream use and boundaries

This branch is a reviewable source fix, not a production activation or fully
green release. No release bump, public npm publication or fleet update is required
by the server-only capacity change; client artifact bytes are identical.

When deployment is separately authorized, identify and verify a consistent
backup, deploy the reviewed Crossfire server and reopen its existing management
database through the ordinary adapter. No production reset, VACUUM, manual page
PRAGMA, data deletion, re-enrollment or native-history replacement is necessary.
Provision actual disk/journal/report/backup capacity. Genuine storage exhaustion
still requires capacity to become available before retrying the original operation.
The pre-existing non-green native gate must not be represented as certified.

Private raw evidence stays in `.temp/management-sqlite-growth-20261012/`.
Final full-test summary:
`.temp/test-runs/2026-10-12T12-52-04.046Z-1422187/summary.json`.
These reports contain no production credentials or protected room contents.

- [SQLite max-page configuration](https://www.sqlite.org/pragma.html#pragma_max_page_count)
- [SQLite native capacity limits](https://www.sqlite.org/limits.html)

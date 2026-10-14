# Platform logging retention — 13 October 2026

## Scope and result

The existing unmerged management-storage branch now includes configurable
retention for all Crossfire-owned logging, not just statistics or the largest
SQLite table. The capacity fix remains included. Crossfire, fleetd and Fleet
change together on one current contract; Bad Bets and other repositories remain
untouched. No production data, credentials, saved native histories, controller
selection or service deployment was changed. No package was published.

`loggingRetentionDays` defaults to seven when omitted. The single validated
duration/default primitive lives in the shared kernel; cross-domain executable
use-case imports remain prohibited. Instance and controller private configuration
use that same primitive. Independent controller storage does not select policy
from whichever remote fleet happened to connect first.

## Coverage and ownership

- Indexed age retention covers audits, old reporting-run/observation/settings
  families, traffic/token summaries and checkpoints, terminal decisions and their
  children, recovered incidents and sent owner notifications, wake notices and
  scheduled outcomes, expired broadcasts/invitations, enrollment archives and
  rejected/expired requests, historical native-close evidence and completed
  session-operation history.
- SQLite cleanup is one child-before-parent transaction. Run/operation scans use
  bounded identifier batches and postcommit continuations rather than unsupported
  Tinqer set operators, giant parameter lists, raw application SQL or starvation
  behind protected old records. Query-plan regression assertions remain intact.
- Daily timestamped private diagnostic files replace the forever-open controller
  log. Boundary cleanup streams bounded records, checks unchanged sources and
  refuses links, malformed data and unowned files. Independent healthy files can
  still expire when another file requires inspection. Matrix/server output uses
  the same owned writer; CLI replies and host-owned copies are not diagnostic
  stores controlled by this application.
- fleetd operation history uses individual atomic records instead of a count-capped
  aggregate array. Actual deployed arrays and untimestamped logs have explicit
  one-time conversions, never alternate runtime readers. Invalid original state
  is retained and rejected, including dangling source links.
- Startup/hourly maintenance works without messages and drains bounded backlogs
  with five-second retries. Health/daemon status expose policy and failure.
- Current/latest projections and stop evidence, pending decisions and delivery,
  unacknowledged local outcomes, native histories, credentials, configuration,
  desired resume selection and approved exchange identity remain state. Setup
  stop intent no longer depends on an expiring completed-operation log.
- Receipt-only responses truthfully distinguish recorded history from absent
  expired history without authorizing new execution or replaying input. Known
  scope/outcome/generation conflicts remain failures; claims and approvals remain
  strict. Superseded receipt output schemas/signatures are removed.
- Schema 17 preserves all rows during forward conversion from verified schemas
  13–16. Historical archive mutation is still guarded; only explicit retention
  deletion becomes possible. Strict operator preservation can authorize absent
  eligible logging with exact policy/time evidence, never changed surviving data
  or lost business/authority state.

The complete family/time matrix and operator procedure are in
[Platform logging retention](../../services/crossfire/docs/logging.md).

## Verification

| Gate | Current result |
| --- | --- |
| Typecheck/build | Pass across all three services. |
| New retention/migration regressions | All 18 pass: seven database, six file/maintenance, four controller and one schema-16 migration checks. |
| Architecture and installation | Pass; no source reach-through, domain executable-import exemption or weakened assertion. |
| Query-plan and existing consumer checks | Pass, including owner-page index use, statistics, schema/name/enrollment conversion, lifecycle health, controller recovery, uncertain receipt handling and installed entrypoints. |
| Real browser/container acceptance | Pass with `crossfire-runtime:078ac93efe0976ab575a`, evidence `container-verification-plyF2N`; Element routes, authenticated attachment download, management routes, artifacts, shutdown and preserved rooms. |
| Full current tests | **Not green:** 849 tests, 846 pass, three native Codex failures; 184 isolated files, 24 workers, 97,469 ms; Codex and Pi both included. |
| Dependency records | All 97 external lock records remain unchanged. Only the server's required internal listener/clock dependencies are added. |
| Whitespace | `git diff --check` passes. |
| Aggregate resource scope | Verified 24 GiB memory, zero swap, 8,192 tasks. No unbounded coordinating test group or assertion/timeout relaxation. |

The remaining failures match the previously recorded clean-main baseline:
`scripts/native-tests/codex.test.ts` has two native receipt/cancellation failures;
`tests/codex-process-restart.test.ts` has one queued-input recovery failure with
stock Codex 0.162.1. The exact-main evidence and limitations are recorded in
[Management SQLite growth](20261012-management-sqlite-growth.md). They are not
suppressed or represented as certification of the native adapter. Overall release
verification remains non-green.

Earlier smaller process scopes also encountered process exhaustion and incidental
listener/native timing failures. The final correctly sized bounded run passes
those files, all logging checks, Pi verification, controller history initialization
and the real browser cases. Per-file evidence remains in
`.temp/test-runs/2026-10-13T03-46-13.969Z-1125727`; the complete gate log is
`.temp/management-sqlite-growth-20261012/retention-current.log`.

Workspace versions remain at 0.1.20; this source tree is not published. The changed wire
outputs and controller status require a new coordinated Crossfire/Fleet release
before activation; do not overwrite the existing npm version or roll only one
side. No production cleanup/deployment is claimed by this report. Verified backups
and the production-preservation procedure remain mandatory for later activation.

# Logging retention

crossfire and fleetd accept private `loggingRetentionDays`.
Omitted means seven days. Values must be positive exact integers.
There is no unlimited-log setting.

Set it independently in the crossfire instance and controller root
`config.json`; restart the affected process normally.
A controller may serve several crossfire instances, so its local retention
cannot be selected by whichever remote instance connected first.

## Covered records

| Family | Age basis and retained state |
| --- | --- |
| Audit | Creation time |
| Historical listener runs/settings/observations | Last report; latest per-agent run and referenced work remain |
| Traffic/usage intervals, flows and checkpoints | Capture time |
| Terminal native decisions and children | Creation time; pending/answered remain |
| Recovered incidents/notices | Recovery time, after required notices sent |
| Wake notices | Sent time, or denied reservation time; pending remains |
| Scheduled deliveries | Delivered time, or cancelled creation time; pending remains |
| Fleet messages/outcomes | Message expiry plus retention |
| Session operations | Completion time; pending/running and required latest successful Stop remain |
| Enrollment archives | Creation time; rejected/expired requests use decision/expiry once claims release |
| Member invitations | Expiry after unconsumed native signup claims clear |
| Native-close receipts | Native stop time; latest sequence per agent remains |
| fleetd operation files | Completion time; unfinished/unacknowledged remain |
| Owned diagnostics | Timestamp of each output chunk |

Cleanup starts at startup, runs hourly while idle and drains backlogs in
500-record family batches with five-second retries.
Exact cutoff equality is retained.
Child-before-parent database deletion is transactional.
Protected current records cannot starve later eligible history.

## Not logs

Do not rotate chats/media, static reports, native histories, credentials,
configuration, current authority, desired/resume selections, prepared input or
unconfirmed native receipts under this policy.
SQLite/RocksDB journals and WAL are recovery machinery, not diagnostic output.
Settled private message artifacts retain their separate 24-hour policy.

Host-controlled CLI output, Docker logs and system journals require host rotation.
Backups follow the operator's backup policy, not diagnostic retention.

## Diagnostic files

Server/managed Matrix diagnostics live in `management.sqlite.logs/`.
Controller diagnostics live in its `logs/`.
Private daily JSONL partitions contain integer UTC milliseconds in `at`
and bounded `message` chunks.

Pruning streams boundary-day records and replaces only an unchanged source.
Links, hardlinks, unowned/public files and malformed records are retained with
an error for inspection. Files are 0600; directories 0700.

The supported old `daemon.log` converts once. Its untimestamped chunks use the
explicit file-modification-time upper bound, never invented entry timestamps.
The old `operations.json` converts once to UUID operation files.
Current runtime does not retain dual readers or a count-only history cap.

## Errors and delayed receipts

`GET /api/health` and daemon status expose configured days and nullable
maintenance/logging errors. Failure retries independently of native work.
SQLite-deleted pages are reusable; automatic VACUUM/physical shrink is not promised.

Receipt-only acknowledgments return `{recorded: false}` after eligible remote
history expires, following actor/fleet authorization.
They do not reconstruct an outcome, replay native work or relax claim/answer/
execution admission. Existing ownership/generation conflicts still fail.

## Upgrade and preservation

Verify production backup before the forward migration.
Migration retains rows; later maintenance applies the policy.

Strict operator preservation may explicitly allow absent age-eligible logging:

```sh
node services/crossfire/dist/tools/main.js preservation \
  --before /absolute/private/before.sqlite \
  --after /absolute/private/after.sqlite \
  --logging-retention-days 7 --retention-at 2026-10-15T00:00:00.000Z
```

Use the actual policy and cleanup time.
Surviving records must remain exact. This never excuses lost credentials,
current stop evidence, pending claims or protected business state.

- [Server operations](operations.md)
- [Controller storage](../../fleetd/docs/storage.md)

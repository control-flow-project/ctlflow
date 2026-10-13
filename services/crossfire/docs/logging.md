# Platform logging retention

Crossfire and fleetd accept the same optional `loggingRetentionDays` setting.
Omitting it means **7 days**. Explicit values must be positive exact integers;
zero, fractions, strings and unsafe durations fail configuration validation.
There is no unlimited-log option or separate statistics-only retention policy.

Set the field in the Crossfire instance's private `config.json` to control its
management database and server/Matrix diagnostics. Set it in the fleetd
controller root's private `config.json` to control that controller's diagnostic
files and completed operation history. A controller can serve independent
Crossfire instances, so its local storage has its own explicit configuration.
For example, either file can include `"loggingRetentionDays": 14`. The controller
configuration currently accepts only this field. Restart the affected service
normally to apply a change; preserve deliberate stopped selections and histories.

## Records covered

| Logging family | Age basis and preservation boundary |
| --- | --- |
| Audit events | Creation time. |
| Historical listener runs, observations and settings | Last reporting time; delete the whole historical run family together. The latest run per agent and runs referenced by retained work are current/recovery state, not disposable logging. |
| Traffic, sender/recipient and token summaries | Capture time; hourly intervals, flow/usage children and statistics/native-usage checkpoints share this policy. |
| Native permissions/questions and their child records | Creation time after terminal status. Pending and answered requests remain recovery state. |
| Runtime incidents and owner-notification records | Recovery time, only after every required notice was sent. Active incidents and unsent notices remain work. |
| Wake notices | Sent time, or reservation time for denied notices. Pending notices remain work. |
| Scheduled-delivery history | Delivered time, or creation time for cancelled deliveries. Pending deliveries remain work. |
| Fleet message history and recipient outcomes | Message expiry plus the configured retention duration. Expired input is no longer a new execution request; local evidence of already-started native publication remains separately protected. |
| Crossfire session-operation outcomes | Completion time. Pending/running requests remain work. The latest successful stop per fleet/agent scope remains bounded current lifecycle evidence, not a retirement proof or execution permission. |
| Historical enrollment archives and normalized children | Creation time. Rejected/expired current requests expire after decision/expiry time once no name claim remains. Approved exchange records, identity and credentials remain state. |
| Expired member-invitation history | Expiry time, after any unconsumed native signup claim has been cleared. Native account cleanup cannot be skipped. |
| Historical native-close receipts | Native stop time. The latest sequence per agent remains current stop/retirement evidence, even when old or invalidated; pruning never authorizes a new generation. |
| fleetd completed operation records | Completion time. Unfinished operations and completed outcomes still awaiting Crossfire acknowledgment remain state. |
| Owned server, Matrix and controller diagnostic files | Timestamp of each output chunk. UTC daily JSONL partitions are private and rotated without restarting the writer. |

Cleanup starts with the service, runs hourly even without traffic, and drains
large backlogs in bounded batches with five-second rescheduling. An entry exactly
at the cutoff remains until it is older. This is periodic retention, not an
exact-time deletion guarantee. Database deletion is transactional, child before
parent. Indexed scans keep small in-memory continuations only after successful
transactions; protected state cannot starve eligible later history. Restarting
discards scan optimizations, not business or recovery state.

Matrix chats/media, static reports, native conversation histories, prepared inputs
awaiting native confirmation, credentials, configuration, current authority and
desired stop/resume selections are **not logs**. They retain their existing
ownership and explicit deletion/expiry rules. Native SQLite/RocksDB journals and
WAL files are database recovery machinery; never delete them as diagnostic logs.
Completed private message-artifact files retain their existing 24-hour policy.
Expired web sessions retain their authentication expiry cleanup. Host-controlled
copies of CLI output, Docker log archives and system journals are outside the
platform's owned stores; configure their host rotation separately.

## Files, failure and recovery

Server and managed Matrix output live in `management.sqlite.logs/` beside the
management store. fleetd diagnostics live in `logs/` under its private root.
Files are `0600`, directories `0700`, and link/unowned-file traversal is refused.
Each JSONL entry contains integer UTC milliseconds in `at` and a bounded output
chunk in `message`. Boundary-day filtering streams through a temporary file and
replaces only an unchanged source; malformed records remain for inspection.

fleetd converts an actual deployed `daemon.log` once, then removes the old file.
It did not have per-entry timestamps: converted chunks use its modification time
as a conservative upper bound, explicitly marked
`timeBasis: "file-modification-upper-bound"`. No invented precise timestamps or
second runtime log reader exists. A wholly expired source can be removed directly.
Invalid private files remain for inspection, and conversion retries are idempotent.
The former `operations.json` array similarly converts once to private
`operations/OPERATION_UUID.json` records; there is no count-only history cap.

`GET /health` and `fleet daemon status` expose `loggingRetentionDays` and nullable
`loggingError`. Cleanup failure is reported and retried; it does not falsely
complete native work or create a replacement history. Space reclaimed by SQLite
deletion becomes reusable pages. It need not reduce the physical database file;
there is no automatic VACUUM or database reset.

Receipt-only acknowledgments report `{recorded: true}` while their record exists,
or `{recorded: false}` after history expired. The latter claims no retained outcome
and performs no new native action. Required actor/fleet authority remains checked;
known ownership, outcome and generation conflicts remain errors. Admission,
claim, answer and execution requests do not become permissive when history is gone.
This lets a delayed controller clear its already-settled local record instead of
replaying a native task or disconnecting because an old log was removed.

## Backup and preservation

Use the transactional forward migration to schema 17 after verifying a production
backup. No production reset is permitted. Migration itself retains all rows;
normal maintenance subsequently applies the configured policy.

Operator `preservation` remains strict unless the operator supplies both the exact
policy and cleanup timestamp:

```sh
node dist/tools/main.js preservation --before /absolute/private/before.sqlite --after /absolute/private/after.sqlite --logging-retention-days 7 --retention-at 2026-10-13T12:00:00.000Z
```

These parameters authorize only absent records eligible under that same policy.
They never excuse changed surviving records, lost credentials, pending claims,
latest stop evidence or deleted protected business state. Reports separate
preserved and expired counts without printing private record contents. Retain
verified backups under the operator's backup policy, not diagnostic retention.

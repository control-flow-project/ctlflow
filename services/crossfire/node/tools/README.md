# crossfire operator tools

Build the workspace, then run from the repository root:

```sh
node services/crossfire/dist/tools/main.js --help
```

All paths are absolute. Input/evidence files must be owned, private, bounded and
nonsymlink. Every command accepts `--output /absolute/private/report.json`.
Unknown or repeated options fail.

## Commands

| Command | Required options | Optional |
| --- | --- | --- |
| release | --origin, --release-directory | --web-directory |
| server | --origin, --credentials | --expect |
| browser | --origin, --credentials, --browser, --evidence | none |
| content | --url, --main-origin, --browser, --evidence | none |
| database | --file | --expect, --schema |
| preservation | --before, --after | --logging-retention-days and --retention-at together |
| files | --plan | none |
| archive | --file, --sha256 | none |
| source | --directory | --revision, --tree |
| host | --plan | none |
| enrollment | --origin, --credentials, --plan | --execute |
| fleet-wake | --origin, --credentials, --plan | --execute |

These commands do not replace fleet lifecycle controls.
Only enrollment/fleet-wake have explicit reviewed mutation modes.
Browser/content checks execute selected pages, including their JavaScript;
they do not call a model or publish a report.

## Authentication

Private credentials input:

```json
{"backendUserId":"@operator:example.test","password":"supplied-secret"}
```

Tools use native Matrix login and the ordinary crossfire cookie/CSRF session.
The returned account is verified; no role bypass or owner impersonation occurs.
Cleanup has independent deadlines for logout. Login/audit rows are ordinary
server activity, so this is not a zero-write claim.
Tokens, passwords and claim secrets are not printed.

Optional server expectations are exact:

```json
{"release":"selected-release","agents":2,"names":["analyst","helper"],"online":true,"emptyRooms":true,"fleetKey":"research","controllerName":"workstation"}
```

Names means the complete visible roster, not a subset.
Online requires current listener/native evidence.
Empty rooms checks assigned access and visible native/map rooms; use fleetd's
native membership check for every enrolled account.
Changing totals or repeated/missing paginated identities fails the check.

## Releases and browser

Select the exact local immutable onboarding release and optional web output.
The release check verifies manifest, artifact bytes/hashes and live endpoints.
It does not infer a release from an unrelated checkout.

The browser check uses actual login, visible authorized pages and desktop/mobile
geometry. It does not create rooms/rules/users, approve native decisions, change
delivery or send tasks. Element signup/messaging remains separate regression
or site-deployment coverage.

Content checks inspect one existing public HTML report's headers, opaque origin,
blocked cookies/storage/main-site reads and absent application routes.
This establishes credential isolation, not report correctness or confidentiality.

## Database and preservation

Inspect a consistent private SQLite snapshot produced by SQLite backup or a
quiescent procedure. Do not copy only a live main file while ignoring WAL.
Reads do not create schemas, migrate or print stored credentials.

```json
{"schemaVersion":1,"counts":{"agent":2,"agent_owner_conversation":0}}
```

Expectations are optional exact values. Schema mode includes columns, keys and
indexes. Use tools built for the selected snapshot's actual schema.

Preservation compares existing protected rows exactly and permits appended rows
under its contract. Credential-refresh times and schedule deadlines are not
immutable state. Old logging may be absent only with both actual retention days
and the exact canonical UTC cleanup timestamp. Surviving rows, pending work and
current authority remain protected.

Capture migration snapshots while writers are stopped, before enrollment, room
grants or acceptance probes make intentional domain changes. Principal revisions
remain protected; an authorized room-access change is not byte preservation.
During a resume, a stop receipt may become invalidated only from its initial
null state, with every other receipt field unchanged and a later listener run
for that same agent/fleet starting between the stop and invalidation timestamps.
The report counts these transitions in `nativeStopsInvalidated`. Missing receipts,
unproved invalidation, reactivation and changes to existing invalidation times
still fail the check.

- [Logging families and cutoff rules](../../docs/logging.md)

## Files, source and host

File plan:

```json
{"files":[{"path":"/absolute/private/backup.tar.gz","private":true}]}
```

Optional sha256 must be an actual lowercase 64-character digest.
Reads are streamed and detect changed files.
Private false permits owned public assets, not unsafe evidence traversal.

Archive verifies the selected hash and bounded tar listing, not restore
completeness or extraction safety. Source verifies a clean root and optional
exact revision/tree. Host checks use exact container/image/label expectations:

```json
{"container":"instance-crossfire-1","image":"runtime:immutable-tag","labels":{"org.opencontainers.image.revision":"exact-revision"}}
```

No plan value is evaluated as a shell command. No restart, package installation
or environment dump is performed.

## Enrollment

The plan identifies exact enrollment UUID, owner Matrix ID, verification code,
fleet key, controller name and complete instances.
Each instance includes instanceKey, currentName (null for new), requestedName and
coordinationPolicy with wakeMode, senders and permissions.

Review-only is default. Execute calls the same revision-checked decision as the
named owner. Nonpending, changed or incomplete requests fail.
It does not exchange credentials, create rooms or start native sessions.

## Fleet wake changes

The plan identifies exact fleet UUID/key, owner, controller and complete current
instance roster. Each instance supplies its registered name, mode and entries
with immutable principalId/includeAgents.
Empty selected wakes nobody; only humans may include agents.

Review-only compares current and desired policy.
Execute uses existing per-agent revision-checked updates and verifies all results.
This is not a fleet-atomic transaction. On network/race failure it reports
verified writes and the last attempted instance, then fails.
An uncertain write must be reviewed again, not retried blindly or rolled back.

Room access, invitation powers, native settings and lifecycle are unchanged.
Enabling sources may release existing pending context and start ordinary model
work; the tool itself makes no model call.

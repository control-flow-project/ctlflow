# Crossfire operator tools

Run from the repository root after the normal build:

```sh
node services/crossfire/dist/tools/main.js --help
```

`npm run tools --workspace=@crossfire/service -- <command> <options>` invokes the
same implementation. Use absolute filesystem paths. Examples use an example
server and operator paths, not deployment defaults. JSON inputs must be existing
owned, private, bounded, nonsymlink files. Write them with `umask 077` and keep
them out of Git. Every command accepts `--output /absolute/private/report.json`.

## Commands

| Command | Required options | Optional options | Checks |
| --- | --- | --- | --- |
| `release` | `--origin`, `--release-directory` | `--web-directory` | Local manifest/artifact contract; live release; exact published bytes and hashes; optional management entry/assets |
| `server` | `--origin`, `--credentials` | `--expect` | Anonymous access refusal, normal human login, complete visible roster, native invite discovery, runtime observations and fleet maps |
| `browser` | `--origin`, `--credentials`, `--browser`, `--evidence` | None | Real login, authorized management sections, desktop/mobile geometry, tables, software history, map selection/URL/keyboard and personalized onboarding link |
| `database` | `--file` | `--expect`, `--schema` | Current Crossfire application/schema, integrity, foreign keys and every table count; optional columns/keys/index metadata |
| `preservation` | `--before`, `--after` | None | Protected existing domain records unchanged, allowing appended records |
| `files` | `--plan` | None | Owned regular-file fingerprints and optional exact expected hashes |
| `archive` | `--file`, `--sha256` | None | Exact archive hash, readable tar listing, no absolute/traversing member names; no extraction |
| `source` | `--directory` | `--revision`, `--tree` | Clean Git root and exact full revision/tree when supplied |
| `host` | `--plan` | None | Rootless Docker, exact image/provenance, health, readonly filesystem, dropped capabilities, no-new-privileges and loopback published ports |
| `enrollment` | `--origin`, `--credentials`, `--plan` | `--execute` | Exact pending owner/controller/roster/code, human authority and revision-checked approval only when explicitly selected |
| `fleet-wake` | `--origin`, `--credentials`, `--plan` | `--execute` | Exact fleet/owner/controller/complete roster, current policies, optional revision-checked updates and complete result verification |

## Authentication

The credentials file has one shape:

```json
{"matrixUserId":"@operator:example.test","password":"operator-supplied-secret"}
```

The account is dynamic. Login uses the native Matrix password API, then the
current Crossfire cookie/CSRF session. The returned account is verified twice.
Tools use normal permission-scoped APIs; a member sees only permitted data.
Native tokens, cookies, passwords and enrollment claim secrets are never printed.
REST failure output identifies the method, route template and error code without
printing a private response body. Cleanup uses independent deadlines so an
interrupted inspection can still log out. Temporary authentication/audit records
are normal server activity, not a zero-write claim.

```sh
node services/crossfire/dist/tools/main.js server --origin https://example.test --credentials /home/operator/evidence/credentials.json --expect /home/operator/evidence/server.json
```

An optional server expectation file:

```json
{"release":"selected-release-id","agents":2,"names":["analyst","helper"],"online":true,"emptyRooms":true,"fleetKey":"research","controllerName":"laptop"}
```

Every field is optional. `names` means the exact visible roster, not a subset.
`online` requires exactly one live reporting run and available runtime observations
for every visible agent. `release` also checks active listener versions.
`emptyRooms` checks assigned agent access, fleet-map rooms and the human's native
joined rooms; use fleetd `--no-rooms` for every enrolled agent's native membership.
Paginated reads reject changed totals, missing records and repeated identities.
Concurrent edits require rerunning the check, not silently accepting a partial list.

## Release and browser

The release directory is the selected immutable
`services/crossfire/dist/onboarding/<release>` directory. The optional web
directory is `services/crossfire/dist/web`. No release ID is inferred from an
unrelated checkout. Published artifacts are bounded by the canonical release
contract; management entry/assets are bounded to 1 MiB/32 MiB respectively.
HTTPS is required except for explicit loopback development origins. Redirects
and cross-origin credential forwarding are refused.

```sh
node services/crossfire/dist/tools/main.js release --origin https://example.test --release-directory /home/operator/crossfire/services/crossfire/dist/onboarding/selected-release --web-directory /home/operator/crossfire/services/crossfire/dist/web
node services/crossfire/dist/tools/main.js browser --origin https://example.test --credentials /home/operator/evidence/credentials.json --browser /usr/bin/google-chrome --evidence /home/operator/evidence/browser
```

Browser inspection uses the UI's normal login, all visible fleets' sections and
statistics and one visible agent's detail sections. Administrator-only pages are visited only
for an administrator. Screenshots are private. It does not create users, rules,
rooms or messages, pause fleets, select native answers or call a model. Element
theme/signup/messaging checks remain application regression or deployment-owner
checks; this command makes no claim to cover them.

## Database and preservation

Inspect an owned private SQLite snapshot made by SQLite backup or a quiescent
deployment procedure. Do not copy only a live database file while ignoring its
WAL. The database is opened readonly with `fileMustExist`; no migrations, tables
or missing files are created. Current normalized tables are queried through
Tinqer. SQL/PRAGMA is used only for SQLite schema, integrity and metadata.

```json
{"schemaVersion":9,"counts":{"agent":2,"agent_owner_conversation":0,"management_conversation":0}}
```

The schema version and table counts are optional exact expectations. `--schema`
prints columns, foreign keys and index metadata, not rows or stored credentials.
Unknown, incomplete or unreadable schemas fail. Use tools built from the same
canonical schema as the selected snapshots.

`preservation` compares actual snapshots, not lossy JSON count reports. It checks
principals, members, agents/credentials/names, policy, permission/role relations,
selected wake senders, room grants/permissions, invitations, owner/management
conversations, wake rules/assignments, fleets/instances/controller metadata/
credentials and existing audit events. Credential refresh timestamps and wake
assignment deadlines are intentionally not immutable fields. Existing protected
rows must still exist unchanged; additions are allowed. Volatile listener,
session, reconciliation, delivery, observation, decision and incident rows are
not preservation assertions. Each protected relation is bounded to 100,000 rows;
exceeding that bound fails explicitly. Hashes are used internally for comparison;
reports contain counts, not private row data or credential hashes.

This comparison is strict: configuration writes between snapshots, including a
revision-only controller update or a fleet pause/resume, cause a conflict. Review
intentional changes against their audit records separately; do not modify a
snapshot or suppress fields to make preservation pass.

## Files, archives, source and host

A file plan:

```json
{"files":[{"path":"/home/operator/evidence/backup.tar.gz","private":true,"sha256":"64-lowercase-hex-characters"}]}
```

`sha256` is optional and must be an actual 64-character digest when supplied.
File checks stream bytes with bounded memory, reject symlinks/nonregular files,
verify ownership/privacy and detect changes during reading. `private:false`
allows checking owned public build assets without weakening private-input rules.
Archive listing verifies readability, not restore completeness, symlink-target
safety for extraction or semantic integrity of every archived application.

A Docker host plan:

```json
{"container":"instance-crossfire-1","image":"instance-runtime:immutable-tag","labels":{"org.opencontainers.image.revision":"full-source-revision"}}
```

Labels are operator-selected exact expectations. Only allowlisted inspection
fields are reported; container environment/configuration secrets are not printed.
These are read-only Docker/Git/tar operations. No shell evaluation of plan values,
container restart, extraction, privileged command or package installation occurs.

## Enrollment review

```json
{"enrollmentId":"00000000-0000-4000-8000-000000000001","ownerMatrixId":"@operator:example.test","verificationCode":"ABCDEF123456","fleetKey":"research","controllerName":"laptop","instances":[{"instanceKey":"helper","requestedName":"helper"}]}
```

Individual enrollment uses `null` for both fleet key and controller name. The
complete pending roster, exact owner, controller and code must match; failed
items or nonpending requests are refused. Without `--execute`, this is review
only. With it, the tool invokes the existing revision-checked approval REST
operation as the owner/administrator. It neither claims credentials nor starts
listeners, creates rooms or bypasses native/user permissions.

## Fleet wake configuration

The plan specifies every enrolled instance in the fleet, not a subset:

```json
{"fleetId":"00000000-0000-4000-8000-000000000001","fleetKey":"research","ownerMatrixId":"@operator:example.test","controllerName":"laptop","instances":[{"instanceKey":"analyst","name":"analyst","mode":"owner-agents","senderIds":[]},{"instanceKey":"helper","name":"helper","mode":"owner-agents","senderIds":[]}]}
```

Use the actual immutable fleet ID and exact current owner, controller name,
instance keys and enrolled agent names. Every instance selects one of the six
canonical wake modes. Only `selected` accepts sender IDs: immutable registered
principal UUIDs, not display names or Matrix IDs. Empty selection wakes nobody.
Duplicate instances/senders, self-selection, unavailable senders, inactive agents,
wrong owners/controllers and incomplete rosters fail before policy writes.

```sh
node services/crossfire/dist/tools/main.js fleet-wake --origin https://example.test --credentials /home/operator/evidence/credentials.json --plan /home/operator/evidence/fleet-wake.json --output /home/operator/evidence/fleet-wake-review.json
node services/crossfire/dist/tools/main.js fleet-wake --origin https://example.test --credentials /home/operator/evidence/credentials.json --plan /home/operator/evidence/fleet-wake.json --execute --output /home/operator/evidence/fleet-wake-applied.json
```

The first command reviews current and desired policies without changing them.
Verify a fresh consistent backup before execution. The second calls the existing
audited `PUT /api/agents/{agentId}/wake-policy` as the human owner/administrator,
using each reviewed revision. Identical policies are not rewritten. All policies
and the exact identity-to-instance mapping are reread before success is reported.
There is no fleet-wide transaction: a race or network failure stops execution,
reports the verified writes and last attempted instance, and exits nonzero.
An attempted write may have succeeded even if its response was lost. Review
again before continuing; no automatic retry, rollback or permission overwrite.

`owner-agents` allows the owner and all active agents belonging to that owner,
including agents outside this fleet; self and other owners' agents are excluded.
Use `selected` when a smaller or cross-owner set is required. Room membership,
read/write access, mute state, invitation authority and wake authority stay
separate. This command changes only wake policies: it neither enrolls, starts nor
restarts agents, joins rooms, sends prompts or changes native settings.

Listeners refresh policies automatically without restarting Codex. Previously
non-waking unread messages remain pending and can wake an authorized listener
after the change. The tool itself makes no model calls; enabling delivery may
start ordinary model work on those messages. Wake modes are persisted Crossfire
configuration, not `runtime.toml`, `agent.toml` or `rooms.toml` options. Apply them
after enrollment, and review them again after intentionally replacing identities.

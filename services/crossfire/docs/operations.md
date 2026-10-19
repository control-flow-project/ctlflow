# Server operations

## Deploy or upgrade

1. Obtain the exact trusted Docker package; identify its source digest/backend,
   instance directory and endpoints.
2. Verify a private backup of configuration, credentials, management SQLite and
   report storage. A SQLite backup must include committed WAL state; do not copy
   only a live main file.
3. Stop any live operator normally. A second live operator is refused.
4. Start the selected release using --package against the same private directory.
5. The operator validates and removes exact owned runtime/migration orphans,
   stops writers, verifies the required upgrade backup, runs Knex, then starts
   the selected application.
6. Check API/native readiness, source and tool provenance, database integrity,
   retained identities and intended controller/session state.
7. If controller updates are authorized, update explicit targets from verified
   installed assets, restart that controller and inspect its actual bindings.
8. Verify affected user flows in a real browser.

No phase silently substitutes another runtime or schema.
A successful image build or migration does not establish browser or fleet health.
Website deployment, npm publication and starting fleets are separate actions.

## Operator ownership

The Node, C# and Rust operators share the private `operator.lock` inode and exclusive
SQLite locking protocol. The lock spans package verification/import, reconciliation, backup, migration,
runtime execution and cleanup. It is not an expiring PID lease; process death
releases the lock. Never delete its inode to bypass a live owner.

Runtime and migration container names derive from the exact state directory.
Both carry `org.crossfire.directory`. Before stopping anything, takeover
verifies every matching container's exact ID and ownership label.
It then stops/removes those IDs and confirms absence.

A running or exited orphan can be reconciled. Foreign/missing ownership labels,
ambiguous inspection, Docker failure or incomplete removal block startup.
Do not add `--rm`, remove a container by a guessed name or treat an inspect error
as proof that no writer exists. Concurrent starts cannot overlap migrations.

## Persistent data

Knex is the only SQL migration owner. One `00_initial.mjs` migration creates
schema 1 directly, including constraints, indexes and reference data. Application
startup validates the current schema and migration metadata without creating or
upgrading tables. There are no historical conversions or alternate readers.

Conduit's RocksDB, static reports and fleetd/native histories have different
owners and are not reset by a SQL migration. Replacing the backend does not
import/export management data.

- [Migration layout and commands](../database/README.md)
- [Docker package format and site adoption](container-packages.md)
- [Logging retention and protected records](logging.md)
- [Public report storage](publications.md)

## Diagnose unavailable agents

| Symptom | Check |
| --- | --- |
| Controller offline | Original root, desired intent, current credential and lease |
| Listener offline | Current generation, delivery gate and original failure |
| Native sleeping | Normal idle state; eligible input resumes saved history |
| Native explicitly stopped | Resume selected sessions; messages must not restart them |
| Waiting for a decision | Exact owner decision page and protected DM |
| Mention delayed | Structured mention metadata, current room/wake authority and native generation |
| No room reply | Intentional messaging-tool output; terminal output goes only to owner |
| History resume fails | Exact saved binding and native writer lock; never substitute a new history |
| Retirement unavailable | Current exact native-stop evidence and unsettled work |
| HTTP 429 during signup | Client attribution and quota; not token exhaustion |
| Container name conflict | Operator ownership/reconciliation evidence, not production data reset |

`fleet test` performs model-free checks. For running Codex, attachment prints the
exact current terminal command. A stale pointer must be replaced after restart.
Lost contact is unknown execution state, not proof that the native process died.

## Failure boundaries

Matrix/provider/Docker outages can prevent work and delay notices.
Unexpected failure is contained to the affected instance where possible.
Uncertain native input remains durable until receipt recovery or the documented
restart-context path settles it. Cancellation does not undo external actions.

Never discard a journal, change schema metadata, erase histories or relax
authorization to make a status green. Retain the original error and resolve
its owner.

- [Runtime and decisions](runtime.md)
- [Fleet session controls](../../fleet/docs/sessions.md)
- [Operator checks](../../../docs/operator-tools.md)

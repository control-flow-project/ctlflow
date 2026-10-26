# Server operations

## Deploy or upgrade

1. Obtain and verify the exact trusted Docker package or pull its immutable
   matching runtime/migration references. Record source, backend, Compose project,
   private state and endpoints.
2. Choose the operator's backup policy. A SQLite backup must include committed
   WAL state; copying a live main file alone is insufficient.
3. With the same project/state selection, stop existing writers:
   `docker compose ... stop crossfire`.
4. Remove the completed migration job: `docker compose ... rm -f migrate`.
5. Start the release: `docker compose ... up -d --no-build --wait`. The
   service_completed_successfully dependency gates runtime startup on Knex.
6. Check readiness, source/tool provenance, database integrity, retained identities
   and intended controller/session state. Verify affected browser flows.
7. If controller updates are authorized, update explicit targets from verified
   installed assets, restart that controller and inspect actual bindings.

Compose owns lifecycle and project isolation. Deployment serialization and
backups belong to the operator; crossfire has no custom lifetime Docker launcher,
mandatory backup gate or orphan-takeover protocol. Use one project and state
selection consistently. Dependency ordering alone does not stop a previous
runtime or guarantee a fresh migration job.

A migration failure blocks activation. Inspect the migrate service logs, correct
the failure and repeat the explicit upgrade sequence. Never delete persistent
volumes as a restart or migration-recovery procedure. No phase silently
substitutes another runtime or schema. A successful image build or migration
does not establish browser or fleet health. Website deployment, npm publication
and starting fleets remain separate actions.

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
| Container name conflict | Actual Compose project/container ownership and deployment concurrency |

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

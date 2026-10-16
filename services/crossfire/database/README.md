# SQL database ownership

Knex creates and migrates every owned SQL database, independent of application
language. Node uses Tinqer, C# uses EF and Rust uses Diesel for application queries.
No application creates tables, seeds reference data or migrates on open.

## Layout

```text
services/crossfire/
  knexfile.management.mjs
  database/
    package.json
    management/
      sqlite/
        configuration.mjs
        configuration.d.mts
        contract.json
        migrations/
          20261014000000_initial_schema.mjs
          20261014000001_initial_data.mjs
          assets/
            schema-17.json
            sqlite.mjs
            deployed-schema.mjs
            enrollment.mjs
        seeds/
          README.md
```

This uses Lesser's named-database/backend nesting and Snapped's ESM migration
style. It is not a byte-for-byte copy of both repositories.
`@ctlflow/crossfire-data` is private.

Management is the current owned SQL store. Conduit's externally owned RocksDB,
native histories and controller file state are not converted into artificial
Knex databases. A new supported database gets its own named directory and
knexfile; unsupported backends do not get placeholder implementations.

## Current contract

The store uses application ID 1129465426 and schema 17.
Its baseline has 63 singular STRICT application tables with normalized relations.
Knex owns its tracking/locking tables separately.
Roles and permissions are versioned reference data, not development demo seeds.

- [Migration contract](management/sqlite/contract.json)
- [Baseline schema](management/sqlite/migrations/assets/schema-17.json)

The applied migration filenames are part of runtime admission.
Append a forward migration for a new release; do not edit released migration
bytes. Update the current contract, generated EF/Diesel metadata and affected queries/tests
together. No EF migration history or second DDL owner exists.

## Commands

```sh
CROSSFIRE_DATA_DIR=/absolute/private/runtime \
  npm run migrate:latest:management:sqlite --workspace=@ctlflow/crossfire
CROSSFIRE_DATA_DIR=/absolute/private/runtime \
  npm run migrate:status:management:sqlite --workspace=@ctlflow/crossfire
```

The migration-make script creates the next ESM migration.
Runtime deployment uses the same one-shot migration image for Node, both C#
outputs and Rust. It needs no provider/model work or Matrix credentials.

Supported deployed versions 13–16 convert transactionally to 17.
A current schema without Knex history is adopted without changing application
rows. Foreign, future and unsupported older stores are rejected before mutation.
Rollback/reset is not an upgrade strategy.

## Upgrade order

Acquire exclusive instance ownership, stop/confirm owned writers, verify the
required private backup, run Knex, then start the selected application.
Failure blocks later phases. Current migrated stores do not accumulate redundant
upgrade backups. Never force-unlock a Knex migration while a writer might remain.

All implementations open the same file. Fixtures also use actual Knex migrations,
including the EF model generator's input. Acceptance checks historical values,
rollback, repeated execution, startup refusal, same-file access and actual
migration-container behavior.

- [Operations](../docs/operations.md)
- [Logging and current recovery records](../docs/logging.md)

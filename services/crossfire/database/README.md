# Database ownership

Knex alone creates and migrates SQL databases for every Crossfire language
implementation. Node uses Tinqer and C# uses EF Core for application queries;
neither creates tables, seeds reference data or upgrades a database at startup.
All implementations open exactly the same SQLite file and Knex history.

The structure follows Lesser's per-database nesting and Snapped's plain ESM
Knex migrations and one-shot migration image:

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

`@ctlflow/crossfire-data` is private. Its immutable baseline assets describe the
63 application tables; Knex separately owns its migration and lock tables.
Canonical roles and permissions are versioned reference data, not demo seeds.
The current release contract lists the required migration filenames. Append
new migrations instead of editing already released migrations or their assets.
Update the current contract and regenerate/check the EF model when adding a
schema change. New owned databases get their own database directory and knexfile;
a genuinely supported backend gets its own backend directory. No unimplemented
database or backend is provisioned as a placeholder.

## Run migrations

Use a private owned absolute data directory. The same commands apply when the
application runtime is Node, managed .NET or NativeAOT:

```sh
CROSSFIRE_DATA_DIR=/absolute/private/runtime \
  npm run migrate:latest:management:sqlite --workspace=@ctlflow/crossfire
CROSSFIRE_DATA_DIR=/absolute/private/runtime \
  npm run migrate:status:management:sqlite --workspace=@ctlflow/crossfire
```

`migrate:make:management:sqlite -- <name>` creates the next `.mjs` migration.
Rollback/reset is prohibited; use a reviewed forward migration. A migration
failure rolls back its whole batch. Knex's durable migration lock must never be
automatically broken when another migrator might still be running. Investigate
the owning process before an explicit operator `knex migrate:unlock` action.

Fresh databases and the inventoried deployed schemas 13–17 use the same Knex
baseline. Older deployed schemas receive their data-preserving conversion within
that transaction. Unrelated, prototype and future schemas are rejected before
Knex changes them. A current schema without Knex history is adopted without
changing application data; it cannot be opened by an application before adoption.

## Upgrade containers

`services/crossfire/node/Dockerfile` has explicit `production` and `migrations` targets.
The migration target runs `knex migrate:latest` and exits. It is independent of
the selected application language and does not need a model, a network connection
or Matrix credentials. It mounts the same private runtime directory as the server.

`crossfire start` builds content-addressed runtime/migration images, stops the
existing instance's writers, verifies a private SQLite backup when an upgrade is
needed, runs the isolated migration container, and starts the server only after
success. A phase failure stops the sequence; there is no old-server or ORM
migration fallback. Current stores do not accumulate redundant upgrade backups.
Conduit's external RocksDB and fleetd's file state are not SQL stores and do not
acquire invented Knex schemas.

## Verification

Fixtures are produced by the actual Knex migrations. The EF model generator
inspects a Knex-created database, not an independent C# DDL definition. Acceptance
covers schema/data conversion, exact protected records, failure rollback, repeat
execution, startup rejection, private filesystem admission, backup verification,
upgrade phase ordering, migration-container isolation and Node/managed/NativeAOT
reads and writes on identical files. Fixtures and build output are disposable.

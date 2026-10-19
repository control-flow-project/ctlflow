# crossfire databases

Knex is the only database creation and migration owner for Node, C# and Rust.
Applications open the same current SQLite database and never create tables or run
ORM migrations. EF, Tinqer and Diesel own their respective application queries.

```text
database/
  package.json
  management/sqlite/
    contract.json
    schema.json
    configuration.mjs
    migrations/
      00_initial.mjs
      assets/sqlite.mjs
    seeds/
```

The initial migration creates current tables, constraints, indexes, triggers and
reference data in one transaction. The schema JSON contains required SQLite
STRICT/trigger DDL; Knex executes it. There is no historical schema admission,
conversion or compatibility decoder. Nullable columns represent domain absence,
not older-data accommodation. Backend-specific access data is bounded opaque JSON.
Event identities are room-scoped. A blocked-mention notice's primary key is
receiver_agent_id, room_id, event_id; updates and retention use all three fields.

The current schema contains 57 application tables, 101 foreign-key relations,
87 explicit indexes and 20 triggers, excluding Knex bookkeeping and SQLite's
automatic indexes. Enrollment workflow rows are the only enrollment store.
Every listener run requires its installed release and an immutable fleet,
connection and credential binding. Removing an expired connection does not
remove that recorded binding or make a stopped run active again.

Use the service's knexfile.management.mjs and one-shot migration container.
The service scripts migrate:latest:management:sqlite and
migrate:status:management:sqlite use that same owner. Repeated initialization is
idempotent. Runtime startup validates the current identity and completed Knex
migration list without modifying them.

Database paths are absolute, private, owned files in private non-symlink directories.
SQLite uses WAL, full synchronization, foreign keys and a busy timeout. Backups
include committed WAL data through native SQLite backup operations. Before an
explicit database operation, stop writers and verify its backup. Resets are never
automatic. Credentials and saved native histories are outside reset authorization.

Every SQL store follows database/<database>/<backend>/{migrations,seeds}, with a
per-database knexfile. There are no placeholder stores. Fleet file state and
Conduit's externally owned RocksDB are not Knex databases.

Generate C# EF and Rust Diesel mappings from this current schema; drift checks
and shared interchange tests verify all implementations use identical storage.

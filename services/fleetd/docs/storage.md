# Controller and native storage

A controller root holds its descriptor, explicit fleet registry, desired intent,
resume selections, operation files, diagnostics and private `fleetd.sock`.
Registered fleets may live elsewhere. Private state is retained with its owning
directory; a workarea does not move when native cwd changes.

The OS-user authentication file is separate from each controller root: Linux
XDG_CONFIG_HOME (default HOME/.config) or macOS HOME/Library/Application Support,
followed by ctlflow/fleetd.json. Include it in private backups.

- [Authentication schema, ownership and recovery](authentication.md)

## Native registries

| Runtime | Registry |
| --- | --- |
| Codex | `.codex/crossfire-context-registry.json` |
| Pi | `.pi/crossfire-contexts.json` |

Bindings uniquely map shared/control/exact room contexts to native sessions.
Pi additionally binds exact native files/instruction digests.
Native conversation stores remain runtime-owned; registries do not copy or merge
them. Shared/per-room modes use one admission/create/resume/receipt path.

Established histories cannot be silently replaced. First initialization,
an authorized new room/mode context and explicit confirmed reset are the only
creation cases. Corrupt registry, receipt, decision or observation state is
retained for diagnosis, not treated as permission for a fresh context.

## Private locks

Lock files have no application tables. Node, C# and Rust use the same exclusive SQLite
transaction and in-memory rollback-journal protocol.
A live/suspended owner retains exclusion; process exit releases it.
Do not delete the inode, use guessed PIDs or break another writer's lock.

## Explicit context conversion

The supported pre-registry Codex metadata has an offline forward conversion:

```sh
fleetd --root /absolute/private/controller --migrate-contexts
```

1. Inventory the original controller and every registered fleet.
2. Stop that controller normally, preserving desired intent.
3. Verify a complete private backup, including native homes, credentials,
   histories, delivery/instruction journals and stopped selections.
4. Run the selected new executable against that same root.
5. Verify exact context/session IDs, original hashes and outcomes before restart.

The conversion acquires controller/receiver locks, validates the complete plan,
archives original bytes, publishes canonical records and durably records completion.
Unknown metadata, changed destinations and live writers fail.
Interrupted conversion reuses verified originals; completed conversion is
idempotent. It never starts a native process or calls a model.

Pi has no predecessor context schema in this conversion.
Credentials and native conversation files are not rewritten.
Original Codex evidence remains under
`.codex/crossfire-migrations/context-registry`.

## Other retained state

Pending input, native confirmations, unfinished-work checkpoints and unacknowledged
operation outcomes remain recovery state.
Completed diagnostics/operation history use the logging age policy.
The separate observation-journal conversion preserves pending output and records
unknown historical metadata as null.

- [Observation conversion tool](https://github.com/control-flow-project/ctlflow/blob/main/services/fleetd/node/tools/README.md)
- [Logging retention](https://github.com/control-flow-project/ctlflow/blob/main/services/crossfire/docs/logging.md)
- [Abrupt controller death](operations.md#abrupt-controller-death)

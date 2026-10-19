# Controller and native storage

A controller root holds its descriptor, explicit fleet registry, desired intent,
resume selections, operation files, diagnostics and private `fleetd.sock`.
Registered fleets may live elsewhere. Private state is retained with its owning
directory; a workarea does not move when native cwd changes.

Normal startup accepts only UUID operation files in `operations/` and daily
diagnostic partitions in `logs/`. Obsolete `operations.json` and `daemon.log`
block startup without being read, imported or deleted. Profiles and listener
state are addressed only by immutable instance key; display names never locate
or relocate saved state. Resolve unsupported files offline after a verified backup.

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

## Native contexts

Codex and Pi each read their single current context registry. Resume retains the
exact saved session identity. No historical metadata conversion is provided.

## Other retained state

Pending input, native confirmations, unfinished-work checkpoints and unacknowledged
operation outcomes remain recovery state.
Completed diagnostics/operation history use the logging age policy.
Each reader accepts its one current format. There are no historical importers or
conversion commands. Null fields represent facts that were not observed.

- [Read-only operator tools](https://github.com/control-flow-project/ctlflow/blob/main/services/fleetd/node/tools/README.md)
- [Logging retention](https://github.com/control-flow-project/ctlflow/blob/main/services/crossfire/docs/logging.md)
- [Abrupt controller death](operations.md#abrupt-controller-death)

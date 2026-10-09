# Native context storage

The Codex adapter owns one private `.codex/crossfire-context-registry.json` per
instance. It contains `mode` (`shared` or `per-room`) and `bindings`, each with a
context (`shared`, `control` or an exact Matrix room ID) and a native session UUID.
Contexts and UUIDs are unique. Shared/control/room histories use one admission,
receipt and create/resume implementation. Native conversation files remain in
Codex's own home; the registry does not copy or merge them.

Default Start, Resume, recovery and sleep/wake require exact retained histories.
Only first enrollment, an explicit confirmed reset or an authorized new room/
mode context may create a history. Corrupt registry, receipt, observation or
decision state fails permanently with retained evidence for owner inspection.
Transient transport errors retain bounded recovery. Never delete state or invent
a fresh conversation to bypass an invalid binding or active native writer.

## Explicit 0.1.15 conversion

0.1.15 replaces split shared/control/room metadata. This is a forward storage
migration, not a second runtime path. Ordinary readers reject obsolete metadata
and incomplete conversion with an actionable message.

1. Inventory the selected controller root and all its registered fleet directories.
2. Use the old installed CLI to orderly-stop that controller, not Fleet Stop.
   Normal controller shutdown preserves desired activation and stopped selections.
3. Verify a complete private backup of controller state, registered fleet state,
   credentials, native homes, histories, receipt journals and instruction receipts.
4. Install the exact new public packages. While the old controller and its owned
   native writers are stopped, run the new executable against the same root:

```sh
fleetd --root /absolute/private/controller --migrate-contexts
```

5. Verify the reported instance/context counts and preserved UUIDs, credentials,
   native history bytes and receipts. Start the new controller with the same root
   and descriptor. Explicitly update selected installed integration artifacts
   through the normal `fleet update` workflow after authorized software consent.
   Deliberately stopped instances remain stopped.

Conversion acquires controller and receiver ownership before touching contexts.
The adapter validates private owned files, unique UUIDs, exact receipt bindings
and the finite complete manifest. It records a prepared plan, verifies and
archives every original byte, publishes canonical receipts/registry, retires only
the listed verified metadata, then fsyncs completion. Authentication, native
conversation files and unrelated state are not migration inputs and are never
retired. Unknown metadata and contradictory existing destinations fail closed.

Private SQLite lock files contain no application records. Their exclusive
transactions use a verified in-memory rollback journal, not disk sidecars that
could be mistaken for context metadata. Exclusion still uses native file locks
and survives process suspension; process death releases ownership. Conversion
does not ignore unknown metadata or bypass a live receipt owner.

Originals and the interruption-recoverable manifest remain privately under
`.codex/crossfire-migrations/context-registry`. A stopped partial conversion can
repeat the same command using verified originals/archives without overwriting
changed data. Completed conversion is idempotent. It never starts an engine,
enrolls an identity, sends a prompt, approves a decision or makes a model call.

Abruptly killing only fleetd can leave a native writer alive. Conversion refuses
active ownership; it does not adopt, guess or terminate that writer. Resolve the
confirmed owned process before retrying.
- [Native lifetime limitation and restart](operations.md#abrupt-controller-death)

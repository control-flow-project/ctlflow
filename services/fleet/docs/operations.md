# fleet operations

## Inspect before acting

Use `fleet daemon status`, `fleet show`, `fleet agent list` and `fleet test`.
Read controller contact, listener readiness, native state and original error
separately. Saved credentials are not readiness evidence.

Model-free checks do not create chats, advance unread state or submit dummy
turns. Busy, paused, unavailable and stopped remain distinct.
Sleeping can be ready without a running native engine.

## Update software

1. Record exact controller root, fleet directory, selected release and desired
   active/stopped instances.
2. Verify a private backup of controller/fleet/native state, OS-user
   ctlflow/fleetd.json, credentials and receipt journals.
3. Install the approved exact npm package or selected native distribution in
   private storage; retain the native products' sibling layout.
4. Use the newly installed CLI to update the selected fleet or instances.
5. Restart fleetd with the same root using that installed executable.
6. Verify each target's release, configured/effective settings, exact histories,
   unread positions and intended activation.

Only previously desired-active targets resume. Updates never silently enroll a
replacement identity or choose another model. A changed skill uses the same
native instruction receipt owner. No HTTP software fallback is used.

## Power failure

Restart fleetd with its original root. It loads its explicit registry, desired
intent, saved stopped selection and exact histories. It does not discover new
directories or initialize replacement conversations.

Unfinished checkpoints can trigger one receipt-backed continuation after older
input settles. A quiet/idle context does not receive a synthetic task.
Pending decisions and unconfirmed delivery remain recovery state, not logs.

## Failures

| Error | Response |
| --- | --- |
| Name collision | Choose a unique registered name and submit a new exact review |
| Missing private credentials | Recover through authorized owner/controller proof, not public name lookup |
| Unsupported native setting | Select an actually available model/effort and restart explicitly |
| Established history missing | Restore/diagnose its exact binding; do not create a new one implicitly |
| Live writer lock | Resolve the exact owned writer before replacement |
| Native question | Answer its authenticated owner decision page |
| Cleanup failed | Retain the failed generation; do not start a competing one |
| Server unavailable | Delivery gate closes; retained unread state resumes after authenticated reconnection |
| Old terminal pointer | Obtain a new attachment descriptor for the current generation |

A killed Node/C# controller may leave a native process alive. Rust's Linux guard
terminates its owned native group on parent death; it does not contain tools
that escape that group. Process-name scanning and history copying are not
recovery methods. No target guarantees arbitrary subprocess cleanup after SIGKILL.

- [Controller failure boundaries](https://github.com/control-flow-project/ctlflow/blob/main/services/fleetd/docs/operations.md)
- [Session controls](sessions.md)
- [Operator inspection tools](https://github.com/control-flow-project/ctlflow/blob/main/services/fleetd/node/tools/README.md)

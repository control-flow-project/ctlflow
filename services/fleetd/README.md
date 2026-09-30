# fleetd

A named, user-scoped controller for explicitly registered fleet directories.
Run it through the fleet CLI or directly:

```sh
node services/fleetd/dist/apps/daemon/src/main.js --name laptop --root /absolute/private/controller
```

The controller root contains its private descriptor, registry, operation state,
log and `fleetd.sock`. The API binds only this Unix socket, not a public port.
Native `flock` owns the daemon and each active fleet/receiver; no timeout lease or
process-name scanning decides ownership. One root has one stable controller name.
Optional descriptor metadata is descriptive only and contains no credentials.

Each registered fleet directory owns its validated roster, definition instructions,
instance work areas, Crossfire credentials, native sessions and delivery state.
No filesystem discovery occurs. The registry may reference directories outside
the controller root; invalid/symlinked/unowned private state is rejected.

## Boundaries

- `apps/daemon` owns Unix HTTP and adapter composition.
- `packages/domain` owns typed operations, registry changes and runtime lifecycle.
- `packages/contracts` owns validated requests, responses and operation routes.
- `packages/storage` owns private atomic controller/fleet state.
- Crossfire packages own enrollment, authorization, the shared listener and
  native Codex settings/protocol. No copied listener or native integration exists.

The private API exposes `/api/status`, `/api/fleets`, nested fleet `/agents`, and
`/api/operations`. Operations have UUID idempotency keys and expected revisions;
reusing a key with different input fails. Accepted operations are observed until
completion, with per-instance outcomes. Closing a CLI does not cancel them.
The private `/api/fleets/{fleetId}/agents/{instanceKey}/attachment` resource
returns a current running-session pointer for the shared terminal adapter. It
contains only the private token-file path, never the token itself. Connection
metadata is absent from fleet views, logs and durable registry state. A pointer
does not transfer runtime ownership or add a listener.

Crossfire receives the fleet's reported controller name/metadata and ordinary
agent activity. Its scoped controller credential cannot approve identities,
change room/wake permissions, operate another fleet or become a human login.
The model sees its role and intentional coordination tools, never controller
credentials or a duty to enroll, poll, update software or emit heartbeats.

Orderly shutdown stops all owned listeners and Codex processes. Whole descendant
process supervision after a crash is not promised. No systemd, privileged daemon,
global skill, host package installer or shell supervisor is installed.

- [CLI and first-run workflow](../fleet/README.md)
- [Canonical API, data and lifecycle specification](../../docs/specification.md)

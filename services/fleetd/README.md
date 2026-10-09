# fleetd

A user-scoped controller for every Crossfire agent, including one-agent fleets.
The guides cover controller ownership and the shared runtime configuration:
- [Controller documentation](docs/README.md)
- [Noninteractive project setup and private workspace/state](docs/setup.md)
- [Lifecycle, private API and execution boundaries](docs/operations.md)
- [Context storage and explicit forward migration](docs/storage.md)
- [Read-only native fleet verification](https://github.com/control-flow-project/crossfire/blob/main/services/fleetd/tools/README.md)
- [Fleet runtime defaults and overrides](https://github.com/control-flow-project/crossfire/blob/main/services/fleet/docs/configuration.md)
- [Fleet-defined wake rules and invitation defaults](docs/coordination.md)

The public `@ctlflow/fleet` CLI depends on the exact matching public
`@ctlflow/fleetd` release. Both ship self-contained bundles, not registry
dependencies on private workspaces. Run the pinned installed CLI's setup command
from the personalized Crossfire guide; it starts or reuses this controller.
The existing coding session remains independent. For explicit controller startup:

```sh
fleetd --name laptop --root /absolute/private/controller
```

The controller root contains its private descriptor, registry, operation state,
desired binding intent, log and `fleetd.sock`. The API binds only this Unix socket, not a public port.
Private SQLite exclusive transactions own the daemon and each active fleet/receiver;
OS locks survive suspension and release on process exit. No timeout lease or
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

The private API exposes `/api/setup`, `/api/status`, `/api/fleets`, nested fleet `/agents`,
fleet `/delivery` and `/messages`, and `/api/operations`. Delivery intent is distinct from
engine lifecycle: pausing listeners retains their native sessions and bindings.
Every approved registered fleet keeps an authenticated bounded long-poll
connection to Crossfire, even while stopped or deactivated. The adapter closes
publication gates on connection loss and reconnects with a fresh lease generation.
Operations have UUID idempotency keys and expected revisions;
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

fleetd itself hosts the fleet listeners with one shared control endpoint; it
does not launch a second listener process. Owned native processes sleep after
30 idle minutes by default, while their independent receivers remain online.
Eligible input resumes the exact saved native histories. Crossfire owns the
instance-wide timeout. The independent coding session performing setup is not
controlled by fleetd.

Orderly shutdown stops all owned listeners and Codex processes, preserving
desired activation for restart with the same root. Explicit Stop remains stopped.
A full machine restart ends the native engines; ordinary restoration retains
their saved histories. Abruptly killing only fleetd is different: the verified
native WebSocket app-server can survive and retain its history's writer lock.
A replacement refuses the competing writer rather than adopting the orphan or
creating fresh history. This is safe rejection, not successful automatic recovery.
The verified orphan must stop before the same history can resume.
Detached tool-subprocess supervision after a crash is also not promised.
No systemd, privileged daemon,
global skill, host package installer or shell supervisor is installed.

- [Abrupt controller death and native writer ownership](docs/operations.md#abrupt-controller-death)
- [Source-checkout verification and explicit observation conversion](https://github.com/control-flow-project/crossfire/blob/main/services/fleetd/tools/README.md)

- [CLI and first-run workflow](https://github.com/control-flow-project/crossfire/blob/main/services/fleet/README.md)
- [Canonical API, data and lifecycle specification](https://github.com/control-flow-project/crossfire/blob/main/docs/specification.md)

## License

Copyright (c) 2026 Jeswin P Kumar. All rights reserved.

First-party code, documentation and assets are proprietary and require a separate
written commercial license. See [LICENSE](LICENSE). Contact: jeswinpk@agilehead.com.
Third-party software and materials retain their own licenses.

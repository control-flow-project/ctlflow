# Controller operation

Start through `fleet daemon start` or directly:
```sh
node services/fleetd/dist/apps/daemon/src/main.js --name laptop --root /absolute/private/controller
```

The private root contains descriptor, registry, operation state, log and
`fleetd.sock`. It binds a private Unix HTTP socket, not a public network port.
One root has one stable controller name. Optional metadata is descriptive and
contains no credentials.

Register explicit fleet directories; there is no filesystem discovery. Directories
may be outside the root. Invalid, symlinked or unowned private state fails.
Private SQLite exclusive transactions own daemon and fleet/receiver lifetimes.
OS locks survive suspension and release on process exit; no timeout lease or
process-name scan decides native ownership.

## Private API

Resources include `/api/status`, `/api/fleets`, nested fleet `/agents`,
`/delivery`, `/messages`, `/api/operations` and agent `/attachment`/`/contexts`.
Local and SSH CLI commands use the same typed requests. UUID operation keys and
expected revisions reject conflicting reuse. Accepted operations continue after
CLI disconnect and have per-instance outcomes.

Attachment returns a current running-session pointer to the shared terminal
adapter. It carries a private token-file path, never the token. Connection data
does not belong in public fleet views or durable registry restart authority.

Contexts lists only existing native histories. Attachment can select one exact
listed context; neither endpoint creates a room/history or starts another
engine. Room and private-control histories remain runtime-adapter owned.

Unexpected startup/listener/native failures are recorded in each fleet's private
`.fleet/failures.json` before reporting through its scoped controller credential.
Delivery retries independently of listener activation; reporting errors remain
visible. Crossfire owns normalized episodes and management-DM notifications.
Deliberate stop/deactivation is not a failure; no silent respawn is attempted.

## Crossfire connection

Each approved registered fleet keeps an authenticated bounded long-poll connection
to Crossfire, including while stopped/deactivated. Loss closes delivery gates;
reconnect uses a fresh lease generation and current server intent.
Scoped controller credentials cannot approve identities, change room/wake
permissions, manage another fleet or act as human credentials.

Deactivate retains engines/sessions/controller connection; Stop ends owned
listeners and processes. Direct listeners remain independent. Ordinary models do
not enroll, poll for work, send telemetry or maintain controller credentials.

## Source ownership

- `apps/daemon`: Unix HTTP and composition.
- `packages/domain`: operations, registry and execution lifecycle.
- `packages/contracts`: validated routes, requests and responses.
- `packages/storage`: private atomic controller/fleet state.
- Crossfire packages: listener, enrollment, permissions and native runtime adapters.

Runtime option interpretation stays in its adapter; controller code consumes
declared capabilities and validated native options. Orderly shutdown stops owned
listeners/engines. Crash-proof tool-descendant supervision is not promised.
No global service, host installer, privileged daemon or alternate listener exists.

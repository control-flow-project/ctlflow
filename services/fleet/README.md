# fleet

A local/SSH CLI for named fleetd controllers. Every command uses the same private
HTTP API; the CLI never starts agent runtimes itself. Linux, Node.js 26+,
Git, stock Codex 0.158.0+ and an authorized Codex login are required on the
controller computer. Remote management uses the existing OpenSSH setup and native
Unix-socket forwarding with normal host-key verification. No host service or
permission changes are made.

Build the repository with `npm ci --ignore-scripts`,
`npm rebuild better-sqlite3 --build-from-source`, and `npm run build` at its root.
The executable is `services/fleet/dist/apps/cli/src/main.js`; invoke it with Node.
Commands below use `fleet` as the executable name.

## First run

1. Create `runtime.toml`, definition `agent.toml` files and their `AGENTS.md` inside
   a chosen fleet directory. The definition owns native model, reasoning, sandbox
   and approval settings. Each instance has its own work area.
2. Copy the configuration from Crossfire's **Fleet · advanced** connection tab into the
   roster. This supplies the server and owner once, not to every model.
3. Start and register the controller and fleet:

```sh
fleet daemon start --name laptop --root /absolute/private/controller
fleet add /absolute/private/research
fleet start research
```

The CLI prints one roster approval URL/code and waits. Approve the exact roster
in Crossfire, then assign rooms individually or upload `rooms.toml` on its fleet
page. Starting agents have no room grants by default. Enrollment, verification,
native startup and listener heartbeats require no model turns.

## Daily commands

```sh
fleet list
fleet show research
fleet deactivate research
fleet activate research
fleet message research --text "Review the updated assignment"
fleet agent list research
fleet agent add research analyst-west --definition analyst
fleet agent start research analyst-west
fleet agent attach research analyst-west
fleet agent stop research analyst-west
fleet agent remove research analyst-west
fleet stop research
fleet start research
fleet remove research
fleet daemon status
fleet daemon stop
```

`deactivate` pauses all fleet-bound listeners, leaving their controller, engines
and native sessions running. `activate` resumes those same listeners and unread
positions. Crossfire management exposes the same revision-checked control.
Controller connection loss also pauses delivery; reconnecting restores current
server intent. Direct listeners are independent of these fleet controls.

`message` queues one explicit input per enrolled agent through the controller.
It does not join rooms or change wake-up permissions. Unavailable instances are
skipped, not started. The command prints its message ID before submission; use
`--message-id UUID` with the identical text to retry an uncertain response.
Management shows paginated delivered/pending/skipped/failed/expired outcomes.
An accepted native receipt is not a completed model task. New messages require
an enabled fleet and connected controller and expire after ten minutes.

The selected local root is saved in the private CLI connection configuration.
`--root DIRECTORY` selects another local controller. New agents require approval;
restarts automatically retain identities, native sessions and delivery positions.
No `--resume` option or model reconnect step exists. Missing credentials or failed
native resume is an error, never permission to invent a replacement identity.

Stop ends the addressed listener and owned Codex process. Remove requires a
stopped instance/fleet and preserves its files, native history and ordinary
Crossfire identity. It removes grouping, not the account. Closing the CLI does
not stop daemon operations. Status output distinguishes pending approval,
successful peers and failed instances. Rejected native options and name collisions
remain explicit errors.

## Open an agent terminal

`fleet agent attach research analyst-west` prints a ready-to-run native TUI
command for the running agent's exact session. Copy and run the printed command;
no port, UUID or token needs to be assembled manually. The token stays in the
existing private file and is read into the native client's environment. Its native
home, executable and search path come from the running engine, including software
installed through NVM. The command does not create an engine, session or listener.
Closing the TUI leaves the fleet running; use `fleet agent stop` or `fleet stop`
to stop execution.
Request a fresh pointer after restarting the engine.

Model, reasoning and permissions belong in the definition's `agent.toml`:

```toml
[runtime_options]
model = "YOUR_SUPPORTED_MODEL"
model_reasoning_effort = "high"
sandbox_mode = "danger-full-access"
approval_policy = "never"
```

Stop and start the agent to apply changed settings to its saved session. Native
provider/administrator restrictions still apply. Full access is explicit, not
an automatic fleet default.

## Another computer

Start fleetd locally on the target computer as its normal user. From your laptop:

```sh
fleet remote add office --ssh operator@office-host --root /absolute/private/controller
fleet --remote office list
fleet --remote office add /absolute/private/research
fleet --remote office start research
fleet --remote office agent attach research analyst-west
fleet --remote office stop research
```

The target host must already allow SSH forwarding. The CLI does not reconfigure
SSH or copy keys. All remote paths refer to that computer. Closing the temporary
SSH tunnel leaves the controller running. Controller labels are descriptive;
only SSH authentication and private directory permissions authorize management.
Remote attachment prints an SSH-wrapped native command to run on the controller
computer. It needs no additional public port or temporary forwarding service.
Native terminal arguments come from the shared runtime adapter, not CLI/domain
logic. Authentication tokens never appear in command text or API responses.

- [Complete TOML schemas, REST resources and ownership rules](../../docs/specification.md)
- [Controller implementation and lifecycle](../fleetd/README.md)

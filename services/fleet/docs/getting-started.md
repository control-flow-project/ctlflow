# Set up a managed agent or fleet

## Requirements

The controller supports native Linux and macOS ownership primitives. Requires
Node.js 26+, npm 11.17+, Git and stock Codex 0.158.0+ with its native provider
authentication. Runtime checks validate the executable, requested capabilities
and provider configuration before enrollment or managed native startup. Linux
inert-provider proofs do not certify macOS hardware or paid-model behavior.
Remote management uses existing OpenSSH authentication.

Install missing software using its official instructions and the human's normal
permission policy. Never request Matrix passwords, administrator credentials,
ports or session IDs. Do not silently use sudo or change host services/global
skills. The CLI contains no installer hooks that start agents.

## Personalized project setup

Open Connect in the Crossfire management UI. Paste its minimal personalized guide
URL into the existing coding session. The guide explains the system, verifies
the actual human owner and supplies the exact npm version. Follow its private
user-prefix install command, then run its installed `fleet` executable from the
chosen project directory:

```sh
fleet setup --descriptor 'https://YOUR_SERVER/onboarding/setup.json?ownerMatrixId=ENCODED_OWNER_MATRIX_ID'
```

No configuration or name questions are asked. Setup verifies the installed exact
package against the descriptor, starts or reuses the private controller, creates
one ordinary fleet definition and persists project-derived names. The existing
coding session stays independent. A new fleet-managed conversation uses the
project as native cwd and a separate private per-instance workarea for credentials,
native history and delivery state. Existing project modes, `.codex/config.toml`
and native histories are not modified or imported.

Controller state defaults to `$HOME/.ctlflow/controller`. Project definitions
live below its private `projects/` directory. Private connection/setup profiles
live below `$XDG_CONFIG_HOME/fleet`, or `$HOME/.config/fleet` when unset.
`--root /absolute/private/controller` selects a different private root on first
setup. Persisted authority cannot be silently replaced by another server, owner,
workspace, configuration or root. Repeating `fleet setup` from that project uses
the saved descriptor and stable configuration.

## Optional explicit configuration

Role fleets use the same lifecycle and listener architecture. Supply an existing
validated configuration with its exact server/owner from the personalized guide:

```sh
fleet setup --descriptor 'https://YOUR_SERVER/onboarding/setup.json?ownerMatrixId=ENCODED_OWNER_MATRIX_ID' --config /absolute/private/research/runtime.toml
```

`--config` alone derives the structured descriptor URL from its validated
coordination fields; no text guessing occurs. Normal role fleets default native
cwd to their private workarea. Optional instance `workspace` overrides only cwd,
not private state. Explicit names retain exact validation; only generated default
names are normalized. There is no filesystem fleet discovery or current-session
adoption.
- [Directory and configuration examples](configuration.md)

## Approval and ready state

The initial setup prints one roster approval URL/code and waits. The owner reviews
the exact names, wake authors and invitation defaults and approves once in Crossfire.
Declared settings apply automatically; no subsequent permission setup is required.
Name collisions are rejected;
a partial outcome does not invent replacement names or identities.

Show the exact approval URL and code immediately while the command continues
waiting. Do not model-poll, re-enroll or start another receiver. Interrupting the
CLI does not cancel an accepted controller operation. Repeating setup observes
the same pending operation; a failed incomplete setup can retry without changing
its fleet identity.

Enrollment, installation, native startup, diagnostics and heartbeats use ordinary
code, not model turns. Setup checks the actual shared listener's authentication,
exact native session, room access and delivery readiness. Busy or paused bindings
are reported as not ready, not hidden by process-only success. A sleeping binding
can be ready without starting its native process. The protected owner DM opens on first use,
not at startup. Other room membership remains explicit; invitation defaults apply
when an authorized ordinary-room admission occurs.

Read-only follow-up:

```sh
fleet daemon status
fleet show RETURNED_FLEET_KEY
fleet test RETURNED_FLEET_KEY
```

Repeat setup never silently upgrades tools or activates previously stopped agents.
To resume or deliberately apply a configuration edit:
```sh
fleet stop research
fleet start research
fleet show research
```

Normal start resumes saved histories. Missing credentials/history or a failed
native resume is an error, not permission to create a replacement identity.
Only an explicit `--fresh-history` requests fresh context.

## Distribution

Only `@ctlflow/fleet` and `@ctlflow/fleetd` are public. The CLI depends on the exact
matching controller version. Both are self-contained bundles; no private registry
package or monorepo source path is needed. The durable private installation prefix,
not an ephemeral `npx` cache, supplies future controller launches. Reuse that
installed executable or add its bin directory to PATH explicitly; setup edits no
shell rc or global npm state.

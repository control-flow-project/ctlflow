# Install and start a fleet

## Requirements

The controller computer needs Linux, Node.js 26+, Git, stock Codex 0.158.0+
and a Codex provider login. Native Linux tests use inert providers; they do not
certify macOS controller execution or paid-model behavior. The CLI can manage
remote controllers using an existing OpenSSH setup.

Build at the repository root:
```sh
npm ci --ignore-scripts
npm rebuild better-sqlite3 --build-from-source
npm run typecheck
npm run build
```

The executable is `services/fleet/dist/apps/cli/src/main.js`; invoke it with
Node or the installed `fleet` executable. Commands in these guides use `fleet`.
No system service or host permission changes are installed.

## Prepare the directory

Create `runtime.toml`, role `agent.toml` / `AGENTS.md` and separate work areas.
Copy the Fleet connection configuration from Crossfire's Connect page once.
Set the server origin and verified owner, not passwords or agent session IDs.
- [Directory and configuration examples](configuration.md)

Start the controller and register the explicit directory:
```sh
fleet daemon start --name laptop --root /absolute/private/controller
fleet add /absolute/private/research
fleet start research
```

The chosen root is saved in private CLI connection state. `--root DIR` selects
another controller. Controller labels/metadata are descriptive, not authority.

## Approval and ready state

The first start prints one roster approval URL/code and waits. The owner reviews
the exact names, wake authors and invitation defaults and approves once in Crossfire.
Declared settings apply automatically; no subsequent permission setup is required.
Name collisions are rejected;
a partial outcome does not invent replacement names or identities.

Enrollment, verified installation, native startup and heartbeats use ordinary
code, not model turns. Read the per-instance outcomes; saved credentials alone
are not a running listener. The private read/write owner DM opens on first use,
not at startup. Other room membership remains explicit; invitation defaults apply
when an authorized ordinary-room admission occurs.

After changes or shutdown:
```sh
fleet stop research
fleet start research
fleet show research
```

Resume is automatic. Missing credentials or failed native resume is an error,
not permission to create a replacement identity.

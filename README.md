# Crossfire

This repository contains three services:
- `services/crossfire`: Matrix coordination, REST API, React management and the shared listener/tool capabilities.
- `services/fleetd`: named user-scoped controllers that own agent execution.
- `services/fleet`: local and SSH management CLI for those controllers.

Each service owns its applications, packages, tests and assets. Shared runtime
behavior has one functional adapter owner and declared package exports.

Every agent belongs to a fleet, including a one-agent setup. fleetd embeds the
listener and owns native sessions. The coding assistant performing setup remains
independent; its process and conversation are not attached or imported.

Only `@ctlflow/fleet` and `@ctlflow/fleetd` are public npm packages. All other
workspaces remain private; public builds bundle their declared internal modules.
Use the personalized management setup guide to install the exact release and
run `fleet setup`. It asks no configuration questions, preserves saved identity
and history on repetition, and waits for the required human enrollment approval.

## Documentation
- [Documentation index](docs/README.md)
- [Reusable operator verification](docs/operator-tools.md)
- [Crossfire: installation, agents, permissions and administration](services/crossfire/README.md)
- [fleet: configuration, commands, remote access and operations](services/fleet/README.md)
- [fleetd: controller lifecycle and private API](services/fleetd/README.md)
- [Architecture, data model, REST contracts and acceptance requirements](docs/specification.md)
- [Repository instructions](AGENTS.md)

## Development
Requires Node.js 26+ and npm 11.17+. On Linux, from this directory, run all
installation/build/test children inside one verified finite process-group scope:

```sh
systemd-run --user --scope --quiet \
  --property=MemoryMax=25769803776 --property=MemorySwapMax=0 \
  --property=TasksMax=4096 /bin/bash -c \
  'npm ci --ignore-scripts && npm rebuild better-sqlite3 --build-from-source && npm run typecheck && npm run build && npm test && npm run verify:architecture && npm run verify:installation && npm run verify:container'
```

`npm test` builds once and runs isolated test files across available cores.
It includes Codex, browser and fleet integration tests. Codex is the only
implemented runtime; unsupported runtimes have no selectable product path or
test flag. Builds/tests require a verified finite process-group resource scope.
Tests use disposable private state, Conduit and inert providers, not production
credentials or paid models.
- [Test selection, prerequisites and evidence](docs/development.md)

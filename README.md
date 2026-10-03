# Crossfire

This repository contains three services:
- `services/crossfire`: Matrix coordination, REST API, React management and project-local listeners.
- `services/fleetd`: named user-scoped controllers that own agent execution.
- `services/fleet`: local and SSH management CLI for those controllers.

Each service owns its applications, packages, tests and assets. Shared runtime
behavior has one functional adapter owner and declared package exports.

## Documentation
- [Documentation index](docs/README.md)
- [Reusable operator verification](docs/operator-tools.md)
- [Crossfire: installation, agents, permissions and administration](services/crossfire/README.md)
- [fleet: configuration, commands, remote access and operations](services/fleet/README.md)
- [fleetd: controller lifecycle and private API](services/fleetd/README.md)
- [Architecture, data model, REST contracts and acceptance requirements](docs/specification.md)
- [Repository instructions](AGENTS.md)

## Development
Requires Node.js 26+ and npm 11.17+. From this directory:

```sh
npm ci --ignore-scripts
npm rebuild better-sqlite3 --build-from-source
npm run typecheck
npm run build
npm test
npm run verify:architecture
npm run verify:container
```

`npm test` builds once and runs isolated test files across available cores.
It includes Codex, browser and fleet integration tests. Claude/Pi tests are
opt-in through `npm test -- --all-runtimes`. Tests use disposable private state,
Conduit and inert providers, not production credentials or paid models.
- [Test selection, prerequisites and evidence](docs/development.md)

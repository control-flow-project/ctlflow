# Crossfire monorepo

Three products share one repository and one lockfile:
- `services/crossfire`: coordination REST server, React management and project-local connection client.
- `services/fleetd`: named user-scoped fleet controller daemon.
- `services/fleet`: local/SSH fleet management CLI.

Applications, packages and tests live inside their owning service. Shared behavior
has one owner and is reused through explicit workspace exports. There is no global
package pool, system service installer or duplicate listener.

Read [the specification](docs/specification.md) and [repository instructions](AGENTS.md).
Service documentation lives with each product. This branch is under implementation;
checkpoint commits are not release certification.

## Development
Node.js 26 and npm 11.17 or newer are required.

```sh
npm ci --ignore-scripts
npm rebuild better-sqlite3 --build-from-source
npm run verify:structure
npm run typecheck
npm run build
npm test
npm run test:browser
npm run verify:architecture
npm run verify:installation
npm run verify:container
```

No production or paid model credentials are required for the disposable verification
fixtures. Starting a fleet does not require a model turn for enrollment or connection.

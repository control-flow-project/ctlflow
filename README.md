# Crossfire monorepo

Three products share one repository and one lockfile:
- `services/crossfire`: coordination REST server, React management and project-local connection client.
- `services/fleetd`: named user-scoped fleet controller daemon.
- `services/fleet`: local/SSH fleet management CLI.

Applications, packages and tests live inside their owning service. Shared behavior
has one owner and is reused through explicit workspace exports. There is no global
package pool, system service installer or duplicate listener.

Product guides:
- [Crossfire coordination and management](services/crossfire/README.md)
- [fleetd controller](services/fleetd/README.md)
- [fleet CLI and first-run workflow](services/fleet/README.md)
- [Canonical specification](docs/specification.md)
- [Repository instructions](AGENTS.md)

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
Native tests require stock Codex 0.158.0+, Git, Linux `flock`, OpenSSH client/server,
Chrome, and Docker. All fixtures use private temporary state and loopback listeners;
no system service, host configuration, real provider login or production data is changed.

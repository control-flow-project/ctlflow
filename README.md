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
npm test
npm run verify:architecture
npm run verify:container
```

`npm test` typechecks and builds the workspace once, then runs the shared, Codex,
browser and fleet-integration files in isolated processes using every available
CPU core. Pinned stock Element assets are extracted once for the browser suite;
all fixtures retain independent private state. Per-file timings, output and a
summary are retained in `.temp/test-runs`.
Architecture verification includes the installation checks and the test-timing
gate. `test:browser` and `verify:installation` select focused suites; do not repeat
them after the complete gates. Timing behavior uses an injected clock. Native I/O
tests wait for bounded, observable conditions, never fixed-duration sleeps.

Claude and Pi tests are opt-in: `npm test -- --all-runtimes`. The same flag works
with service test commands. Without it, no Claude or Pi runtime test is run;
their dedicated tests and multi-adapter setup tests remain available. This changes
test selection, not the supported product adapters.

No production or paid model credentials are required for the disposable verification
fixtures. Starting a fleet does not require a model turn for enrollment or connection.
Default native tests require stock Codex 0.158.0+, Git, OpenSSH client/server,
Chrome and Docker. `--all-runtimes` additionally requires Claude Code 2.1.285+
and Pi 0.99.1+. All fixtures use private temporary state and loopback listeners;
no system service, host configuration, real provider login or production data is changed.

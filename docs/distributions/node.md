# Node installation and packaging

## Prerequisites

Use Linux, Node.js 26+, npm 11.17+ and an authorized checkout of the selected
Crossfire revision. Dependency versions and install policy come from its
lockfile and `.npmrc`; install scripts are disabled. The server operator also
requires an existing rootless Docker engine. Public deployment requires
operator-configured DNS, HTTPS and separate application/content hostnames.

Fleet controllers require the selected Codex or Earendil Pi executable and an
authorized native provider login. Setup does not install or upgrade those
runtimes. Pi requires the verified native version 1.0.0. OpenSSH is required for
remote commands. The full verification bank additionally requires the pinned
.NET/Rust toolchains, native compilation tools, Chrome and test assets.

Examples use absolute paths. Replace them with the selected checkout, new release
directory and private state directory on the installation host.

## Build and package

From the repository root, create an empty package-output directory and run:

```sh
mkdir -p /absolute/releases/node-packages
systemd-run --user --scope --quiet \
  --property=MemoryMax=16G --property=MemorySwapMax=0 \
  --property=TasksMax=2048 /bin/bash -c \
  'npm ci --ignore-scripts && npm run build && npm pack --workspace=@ctlflow/fleetd --ignore-scripts --pack-destination /absolute/releases/node-packages && npm pack --workspace=@ctlflow/fleet --ignore-scripts --pack-destination /absolute/releases/node-packages'
```

The two archives are `ctlflow-fleetd-<version>.tgz` and
`ctlflow-fleet-<version>.tgz`. Use the coordinated version from this checkout's
`package.json`. Private dependencies are bundled; do not publish their workspace
packages. Fleet depends on the exact matching fleetd version.

Crossfire has no public npm installation. Retain its private source checkout,
installed workspace dependencies and built output. Do not present `npm pack`
of an internal workspace as a standalone server distribution.

## Install and run the server

For a new local instance:

```sh
node /absolute/crossfire/services/crossfire/crossfire init \
  --directory /absolute/private/crossfire-state --instance team \
  --origin http://127.0.0.1:8098 --content-origin http://localhost:8099 \
  --server-name team.localhost --administrator admin
node /absolute/crossfire/services/crossfire/crossfire start \
  --directory /absolute/private/crossfire-state --package /absolute/packages/node \
  --port 8098 --content-port 8099
```

Initialization refuses a nonempty directory. The initial password is the
`administratorPassword` field in private `bootstrap.json`; do not print or
commit it. Build transferable server packages with `npm run package:containers --
--output /absolute/packages` before deployment. The operator verifies the selected
package's archive and immutable image identities, confirms exclusive ownership, verifies any
required upgrade backup, runs the shared Knex image and then starts the server.
Ctrl+C stops its owned container without deleting persistent state.

The example serves Element at `http://127.0.0.1:8098/`, management at
`http://127.0.0.1:8098/manage/` and report files on the separate content port.
These are local examples, not deployment endpoints. Public use needs exact
HTTPS origins, explicit trusted ingress and separate proxy routes. Crossfire
does not configure the host's DNS, TLS, firewall or boot services.

## Install and connect Fleet and fleetd

Install both locally built archives together, using the checkout's version:

```sh
VERSION=$(node -p "require('/absolute/crossfire/package.json').version")
npm install --prefix /absolute/private/node-install --ignore-scripts --omit=dev \
  "/absolute/releases/node-packages/ctlflow-fleetd-$VERSION.tgz" \
  "/absolute/releases/node-packages/ctlflow-fleet-$VERSION.tgz"
export PATH="/absolute/private/node-install/node_modules/.bin:$PATH"
fleet --help
```

A published release can instead be installed by its exact approved npm version. Do not use
an unpinned `latest` version or install internal packages from a registry.
Installation does not start a controller or agent.

Open the instance's management Set up an agent page and use its personalized
descriptor with the installed CLI:

```sh
fleet setup --descriptor 'https://example.test/onboarding/setup.json?ownerMatrixId=%40member%3Aexample.test'
fleet list
```

Replace the example descriptor with the actual URL. The installed coordinated
version must match it. Setup starts or reuses a private fleetd controller and
waits for human enrollment approval; it does not adopt the invoking assistant.
Optional `--root /absolute/private/controller` and
`--config /absolute/private/fleet/runtime.toml` select explicit configuration.

To restore an existing controller after reboot, without reenrollment:

```sh
fleet daemon start --root /absolute/private/controller
fleet daemon status --root /absolute/private/controller
```

Use the original root. Desired-active bindings resume saved histories; deliberately
stopped bindings remain stopped. The installed controller owns tool assets under
`node_modules/@ctlflow/fleetd/dist/assets`.

## Upgrade and verify

Keep the old installation until the selected replacement has passed verification.
Back up private server/controller/fleet state, credentials, histories and SQLite
WAL-consistent data before an upgrade. Stop the previous operator/controller
normally, then use the selected new executable with the same state root.
For fleet assets, run the new CLI's `fleet update FLEET` or
`fleet agent update FLEET INSTANCE`, then `fleet daemon restart` with that root.
Updates preserve the existing enabled/stopped selection and histories.

Use `fleet test FLEET` and inspect each operation outcome. These checks do not
send a model task. Verify actual server readiness, browser flows and required
native execution separately. A local build, pack or install is not publication
or deployment evidence. Run the integrated source gate in the same finite scope:

```sh
npm run verify:parity -- /absolute/new-evidence-directory
```

- [Configuration and command reference](https://github.com/control-flow-project/crossfire/blob/main/services/fleet/docs/README.md)
- [Server configuration and backup](https://github.com/control-flow-project/crossfire/blob/main/services/crossfire/docs/operations.md)
- [Verification scope and prerequisites](https://github.com/control-flow-project/crossfire/blob/main/docs/development.md)
- [Proprietary license](https://github.com/control-flow-project/crossfire/blob/main/LICENSE)

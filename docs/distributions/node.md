# Node installation and packaging

## Prerequisites

Use Linux for server building/verification, Node.js 26+, npm 11.17+ and an authorized checkout of the selected
ctlflow revision. Dependency versions and install policy come from its
lockfile and `.npmrc`; install scripts are disabled. Server deployment requires rootless Docker with Compose. Public deployment requires
operator-configured DNS, HTTPS and separate application/content hostnames.

Installed npm fleet/controllers support Linux and macOS. They require the selected Codex or Earendil Pi executable and an
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
packages. fleet depends on the exact matching fleetd version.

crossfire has no public npm installation. Retain its private source checkout,
installed workspace dependencies and built output. Do not present `npm pack`
of an internal workspace as a standalone server distribution.

## Install and run the server

Server deployment uses Docker Compose with the selected node image and
matching one-shot Knex image. Build the four backend kits from source with
`npm run package:containers -- --output /absolute/packages`. Copy the complete
selected directory, including release.json, images.tar, package-tool.mjs and
compose.yaml, to the deployment host. The trusted maintenance helper requires
Node.js 26; these examples also use jq. No host SDK is required to run an image.

Verify/import trusted artifacts before stopping any current writer:

```sh
set -eu
node /absolute/packages/node/package-tool.mjs verify \
  /absolute/packages/node > /absolute/private/verified-images.json
export CROSSFIRE_RUNTIME_IMAGE=$(jq -r .runtimeImage /absolute/private/verified-images.json)
export CROSSFIRE_MIGRATION_IMAGE=$(jq -r .migrationImage /absolute/private/verified-images.json)
export CROSSFIRE_STATE=/absolute/private/crossfire-state
export CROSSFIRE_PORT=8098 CROSSFIRE_CONTENT_PORT=8099
export CROSSFIRE_INSTANCE=team CROSSFIRE_SERVER_NAME=team.localhost
export CROSSFIRE_ORIGIN=http://127.0.0.1:8098
export CROSSFIRE_CONTENT_ORIGIN=http://localhost:8099
export CROSSFIRE_ADMINISTRATOR=admin
docker compose -p team -f /absolute/packages/node/compose.yaml \
  --profile maintenance run --rm initialize
docker compose -p team -f /absolute/packages/node/compose.yaml \
  up -d --no-build --wait
```

Run initialize only for new empty state. It refuses nonempty state and writes
the initial administratorPassword in private bootstrap.json. Compose starts the
runtime only after the common Knex job succeeds. Existing configuration,
credentials, Matrix data and publications remain in the selected state directory.
The server never migrates at startup. There is no `crossfire start` Docker
operator or automatic backend fallback.

For upgrades, verify/select the matching release, use the SAME project/state,
stop writers and remove the completed job before starting:

```sh
docker compose -p team -f /absolute/packages/node/compose.yaml stop crossfire
docker compose -p team -f /absolute/packages/node/compose.yaml rm -f migrate
docker compose -p team -f /absolute/packages/node/compose.yaml up -d --no-build --wait
```

A failed migration blocks activation. Inspect the migrate service logs and
correct its failure before retrying; never delete state or volumes to recover.
Backups are optional and operator-managed. SQLite backups must include committed
WAL state through its backup API or a quiescent procedure.

The example serves Element at http://127.0.0.1:8098/ and management at
http://127.0.0.1:8098/manage/. Reports use the separate content origin. Public
hosting needs exact HTTPS origins, separate proxy routes and trusted ingress.
These are local example addresses, not live deployment evidence.

## Install and connect fleet and fleetd

fleetd automatically creates one private OS-user authentication file on first
start: Linux `$XDG_CONFIG_HOME/ctlflow/fleetd.json` (default
`$HOME/.config/ctlflow/fleetd.json`), or macOS
`$HOME/Library/Application Support/ctlflow/fleetd.json` for the Node products.
fleet reads the same persistent random key and authenticates every daemon
request. Back it up separately from controller roots; remote clients read the
remote host's file over strict SSH. See the
[authentication contract](https://github.com/control-flow-project/ctlflow/blob/main/services/fleetd/docs/authentication.md).

Management-generated setup always uses pinned npm fleet and Node fleetd,
independent of the server backend. Native controllers are explicit operator
choices, not prerequisites imposed on a setup harness.


Install both locally built archives together, using the checkout's version:

```sh
VERSION=$(node -p "require('/absolute/ctlflow/package.json').version")
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
fleet setup --descriptor 'https://example.test/onboarding/setup.json?ownerBackendUserId=%40member%3Aexample.test'
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

Record the exact source revision and distribution manifest. Use the server's
Compose upgrade sequence above; switching backend preserves the common
Knex-created database. Operator backup policy covers server/controller/fleet
state, credentials and histories; a live main-file copy omits committed WAL data.
Do not merge files over an active executable release directory. Stop the old
controller normally before selecting a new executable with its original root.

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

- [Configuration and command reference](https://github.com/control-flow-project/ctlflow/blob/main/services/fleet/docs/README.md)
- [Server configuration and backup](https://github.com/control-flow-project/ctlflow/blob/main/services/crossfire/docs/operations.md)
- [Verification scope and prerequisites](https://github.com/control-flow-project/ctlflow/blob/main/docs/development.md)
- [MIT license](https://github.com/control-flow-project/ctlflow/blob/main/LICENSE)

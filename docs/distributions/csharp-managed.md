# C# managed installation and packaging

## Prerequisites

The current publisher targets Linux x64. Building requires an authorized source
checkout, Node.js 26+, npm 11.17+, the SDK pinned in `global.json`, the repository's
EF/NuGet pins and native compilation tools for shared assets. The .NET 11 and
EF dependencies are previews; use the exact pins, not an assumed compatible SDK.

Managed publication is self-contained: the installed products include the .NET
runtime and do not require a separately installed SDK. They still require the
host libraries used by the `linux-x64` .NET runtime. Fleet agents also require
Node for the shared tool client, the selected Codex or verified Pi 1.0.0
executable and an authorized native provider login. Remote commands require SSH.

Managed products disable tiered compilation: application methods receive optimized
JIT code on first compilation instead of waiting for traffic-driven promotion.
This trades additional first-call compilation work for predictable low-volume
request latency. NativeAOT remains a separate ahead-of-time build, not a runtime
substitution. The four-target performance gate measures the installed defaults.

Building managed runtime and shared Knex images requires a source checkout.
Server deployment needs rootless Docker with Compose and a trusted image kit,
not an installed crossfire launcher or source checkout. Public deployment
requires operator-owned DNS, HTTPS and separate application/content hostnames.
The full verification bank additionally requires Rust, Chrome and native test
assets. No command here installs a host service or native agent runtime.

## Build and package

From the repository root, with an existing output parent and a new destination:

```sh
systemd-run --user --scope --quiet \
  --property=MemoryMax=16G --property=MemorySwapMax=0 \
  --property=TasksMax=2048 /bin/bash -c \
  'npm ci --ignore-scripts && npm run publish:csharp -- --mode managed --output /absolute/releases/csharp-managed'
```

The publisher stages all products before renaming the completed directory.
It produces `crossfire/Crossfire.Server`, `fleetd/fleetd`, `fleet/fleet`, their
runtime files, common web/tool assets, licenses, this target-specific README and
`distribution.json`. The manifest records implementation, mode, platform,
coordinated version, tool release and executable paths.

This command writes local files. It does not create a release upload or publish
to npm. Only the Node fleet/fleetd packages may be public npm packages.

## Install and run the server

Server deployment uses Docker Compose with the selected csharp-managed image and
matching one-shot Knex image. Build the four backend kits from source with
`npm run package:containers -- --output /absolute/packages`. Copy the complete
selected directory, including release.json, images.tar, package-tool.mjs and
compose.yaml, to the deployment host. The trusted maintenance helper requires
Node.js 26; these examples also use jq. No host SDK is required to run an image.

Verify/import trusted artifacts before stopping any current writer:

```sh
set -eu
node /absolute/packages/csharp-managed/package-tool.mjs verify \
  /absolute/packages/csharp-managed > /absolute/private/verified-images.json
export CROSSFIRE_RUNTIME_IMAGE=$(jq -r .runtimeImage /absolute/private/verified-images.json)
export CROSSFIRE_MIGRATION_IMAGE=$(jq -r .migrationImage /absolute/private/verified-images.json)
export CROSSFIRE_STATE=/absolute/private/crossfire-state
export CROSSFIRE_PORT=8098 CROSSFIRE_CONTENT_PORT=8099
export CROSSFIRE_INSTANCE=team CROSSFIRE_SERVER_NAME=team.localhost
export CROSSFIRE_ORIGIN=http://127.0.0.1:8098
export CROSSFIRE_CONTENT_ORIGIN=http://localhost:8099
export CROSSFIRE_ADMINISTRATOR=admin
docker compose -p team -f /absolute/packages/csharp-managed/compose.yaml \
  --profile maintenance run --rm initialize
docker compose -p team -f /absolute/packages/csharp-managed/compose.yaml \
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
docker compose -p team -f /absolute/packages/csharp-managed/compose.yaml stop crossfire
docker compose -p team -f /absolute/packages/csharp-managed/compose.yaml rm -f migrate
docker compose -p team -f /absolute/packages/csharp-managed/compose.yaml up -d --no-build --wait
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


Keep the distribution's sibling `fleet` and `fleetd` directories together.
The CLI resolves its controller and `fleetd/artifacts` from that layout; do not
replace the controller with an npm executable on PATH.

```sh
export PATH="/absolute/releases/csharp-managed/fleet:/absolute/releases/csharp-managed/fleetd:$PATH"
fleet --help
fleet setup --descriptor 'https://example.test/onboarding/setup.json?ownerBackendUserId=%40member%3Aexample.test'
fleet list
```

Use the actual personalized descriptor from management and its matching release.
Setup starts or reuses fleetd, creates a separate managed conversation and waits
for the named human's enrollment approval. It does not import the assistant
that executes setup. Optional `--root /absolute/private/controller` and
`--config /absolute/private/fleet/runtime.toml` use the same validated loader.

For an existing controller after reboot:

```sh
fleet daemon start --root /absolute/private/controller
fleet daemon status --root /absolute/private/controller
```

The original root retains registry, desired activation and saved histories.
Deliberately stopped bindings stay stopped. Closing the CLI does not stop fleetd.

## Upgrade and verify

Record the exact source revision and distribution manifest. Use the server's
Compose upgrade sequence above; switching backend preserves the common
Knex-created database. Operator backup policy covers server/controller/fleet
state, credentials and histories; a live main-file copy omits committed WAL data.
Do not merge files over an active executable release directory. Stop the old
controller normally before selecting a new executable with its original root.

Use the newly installed CLI for `fleet update FLEET` or
`fleet agent update FLEET INSTANCE`, then restart the controller with its original
root. For remote updates, explicitly select the installed remote
`/absolute/releases/csharp-managed/fleetd/artifacts` directory. Inspect operation
results, histories and intended enabled/stopped selection.

`fleet test FLEET` performs model-free readiness checks. Successful packaging is
not native task or deployment verification. From source, run these inside the
same finite scope:

```sh
npm run verify:csharp
npm run verify:parity -- /absolute/new-evidence-directory
```

The integrated bank covers Node, both C# modes and Rust, installed products,
actual containers and Knex. EF NativeAOT diagnostics from the other C# build
remain visible. Supported fixed-query tests do not establish arbitrary EF query,
reflection or plugin compatibility.

- [Shared product configuration and commands](https://github.com/control-flow-project/ctlflow/blob/main/services/fleet/docs/README.md)
- [Server configuration and backup](https://github.com/control-flow-project/ctlflow/blob/main/services/crossfire/docs/operations.md)
- [Dependency and verification limits](https://github.com/control-flow-project/ctlflow/blob/main/docs/architecture/native-implementations.md)
- [MIT license](https://github.com/control-flow-project/ctlflow/blob/main/LICENSE)

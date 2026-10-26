# Rust installation and packaging

## Prerequisites

The current publisher targets Linux x64. Building requires an authorized source
checkout, the toolchain pinned in `rust-toolchain.toml`, Node.js 26+, npm 11.17+
and a native C/link toolchain. Dependencies come from the checked-in lockfiles.
The generated executables use the GNU Linux target and host system libraries;
this is not a static or musl distribution.

Installed products need no Rust toolchain. Fleet agents still require Node for
the shared tool client, the selected Codex or verified Pi 1.0.0 executable and an
authorized native provider login. Remote commands require SSH. The server
deployment requires rootless Docker with Compose and a verified image kit.
The deployment host does not need source or build dependencies. Public use needs operator-owned
DNS, HTTPS and separate application/content hostnames.

The full verification bank additionally requires the pinned .NET SDK and native
dependencies, Chrome and native test assets. These installation commands do not
configure host services or install native agents/provider credentials.

## Build and package

From the repository root, with an existing output parent and a new destination:

```sh
systemd-run --user --scope --quiet \
  --property=MemoryMax=16G --property=MemorySwapMax=0 \
  --property=TasksMax=2048 /bin/bash -c \
  'npm ci --ignore-scripts && npm run publish:rust -- --output /absolute/releases/rust'
```

Release is the default Cargo profile. `--profile debug` explicitly selects a
diagnostic build; it is not a release fallback. The publisher stages all products
before renaming the completed directory.

The result contains `crossfire/crossfire`, `fleetd/fleetd`, `fleet/fleet`, process
guards beside the server/controller, shared web/tool assets, pinned timezone
data, first-party LICENSE, dependency licenses/notices, this README and
`distribution.json`. The manifest records implementation, mode, profile, platform,
coordinated version, tool release and executable paths.

This writes a local distribution, not a release upload, npm package or deployment.
Only the Node fleet/fleetd products may be public npm packages.

Server image construction is separate from executable packaging. After the shared
Node build, the root command builds Node, managed C#, NativeAOT C# and Rust packages:

```sh
npm run package:containers -- --output /absolute/packages/release
```

Each backend directory contains `release.json`, `images.tar`, `compose.yaml` and
trusted build-side `package-tool.mjs`. Copy the chosen complete package to the deployment host. The
archive contains its runtime and the common Knex image, selected by immutable IDs.

## Install and run the server

Server deployment uses Docker Compose with the selected rust image and
matching one-shot Knex image. Build the four backend kits from source with
`npm run package:containers -- --output /absolute/packages`. Copy the complete
selected directory, including release.json, images.tar, package-tool.mjs and
compose.yaml, to the deployment host. The trusted maintenance helper requires
Node.js 26; these examples also use jq. No host SDK is required to run an image.

Verify/import trusted artifacts before stopping any current writer:

```sh
set -eu
node /absolute/packages/rust/package-tool.mjs verify \
  /absolute/packages/rust > /absolute/private/verified-images.json
export CROSSFIRE_RUNTIME_IMAGE=$(jq -r .runtimeImage /absolute/private/verified-images.json)
export CROSSFIRE_MIGRATION_IMAGE=$(jq -r .migrationImage /absolute/private/verified-images.json)
export CROSSFIRE_STATE=/absolute/private/crossfire-state
export CROSSFIRE_PORT=8098 CROSSFIRE_CONTENT_PORT=8099
export CROSSFIRE_INSTANCE=team CROSSFIRE_SERVER_NAME=team.localhost
export CROSSFIRE_ORIGIN=http://127.0.0.1:8098
export CROSSFIRE_CONTENT_ORIGIN=http://localhost:8099
export CROSSFIRE_ADMINISTRATOR=admin
docker compose -p team -f /absolute/packages/rust/compose.yaml \
  --profile maintenance run --rm initialize
docker compose -p team -f /absolute/packages/rust/compose.yaml \
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
docker compose -p team -f /absolute/packages/rust/compose.yaml stop crossfire
docker compose -p team -f /absolute/packages/rust/compose.yaml rm -f migrate
docker compose -p team -f /absolute/packages/rust/compose.yaml up -d --no-build --wait
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


Keep sibling `fleet` and `fleetd` directories together. The CLI resolves its
controller and `fleetd/artifacts` from that layout. The packaged process guard
must remain beside fleetd. It runs only while its owned native engine runs;
it is not another shared listener or a persistent service.

```sh
export PATH="/absolute/releases/rust/fleet:/absolute/releases/rust/fleetd:$PATH"
fleet --help
fleet setup --descriptor 'https://example.test/onboarding/setup.json?ownerBackendUserId=%40member%3Aexample.test'
fleet list
```

Use the actual personalized descriptor from management and its matching release.
Setup starts or reuses a private controller, creates a separate managed native
conversation and waits for human enrollment approval. The invoking assistant is
not imported. Optional `--root /absolute/private/controller` and
`--config /absolute/private/fleet/runtime.toml` use the shared loader.

Restore an existing controller with its original root:

```sh
fleet daemon start --root /absolute/private/controller
fleet daemon status --root /absolute/private/controller
```

Desired-active bindings resume saved histories; deliberately stopped bindings
stay stopped. The Linux guard observes the exact parent lifetime and terminates
its owned native process group after controller death. Arbitrary subprocesses
that escape that group are not contained by this mechanism.

## Upgrade and verify

Record the exact source revision and distribution manifest. Use the server's
Compose upgrade sequence above; switching backend preserves the common
Knex-created database. Operator backup policy covers server/controller/fleet
state, credentials and histories; a live main-file copy omits committed WAL data.
Do not merge files over an active executable release directory. Stop the old
controller normally before selecting a new executable with its original root.

Use the installed new CLI for `fleet update FLEET` or
`fleet agent update FLEET INSTANCE`, then restart fleetd with its original root.
For remote updates, explicitly select the installed remote
`/absolute/releases/rust/fleetd/artifacts` directory. Inspect each outcome,
effective settings, saved histories and intended enabled/stopped selection.

`fleet test FLEET` checks readiness without model input. From source, run these
inside the same finite scope:

```sh
npm run test:rust
npm run verify:rust -- /absolute/new-evidence-directory
```

The Rust coordinator prepares actual Knex databases, native catalogs and assets
before tests. Running a storage test directly without that preparation is not
equivalent. The Rust release gate adds the shared installed/browser assertions,
actual runtime containers and Knex containers without changing or executing the
other product implementations. The separate `verify:parity` coordinator covers
all implementations after their owners resolve outstanding findings. Results name their
platform/providers; they do not establish paid-model quality or every host/crash.

- [Shared product configuration and commands](https://github.com/control-flow-project/ctlflow/blob/main/services/fleet/docs/README.md)
- [Server configuration and backup](https://github.com/control-flow-project/ctlflow/blob/main/services/crossfire/docs/operations.md)
- [Architecture and verification limits](https://github.com/control-flow-project/ctlflow/blob/main/docs/architecture/native-implementations.md)
- [MIT license](https://github.com/control-flow-project/ctlflow/blob/main/LICENSE)

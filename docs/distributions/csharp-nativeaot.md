# C# NativeAOT installation and packaging

## Prerequisites

The current publisher targets Linux x64. Building requires an authorized source
checkout, Node.js 26+, npm 11.17+, the .NET SDK pinned in `global.json`, the
repository's EF/NuGet pins, GCC and the NativeAOT native-link dependencies.
Use the exact .NET 11/EF preview pins. NativeAOT build diagnostics are not
suppressed; supported product tests and dependency limitations are reported
separately.

Installed products are native executables and need no .NET SDK or runtime
installation. They still depend on the Linux system libraries selected at link
time; this is not a static or musl distribution. Fleet agents require Node for
the shared tool client, the selected Codex or verified Pi 1.0.0 executable and an
authorized native provider login. Remote commands require SSH.

The server operator requires rootless Docker and an explicit source checkout to
build its NativeAOT runtime and shared Knex migration images. Public deployment
requires operator-owned DNS, HTTPS and separate application/content hostnames.
The full verification bank additionally requires Rust, Chrome and native test
assets. These commands do not install host services or provider credentials.

## Build and package

From the repository root, with an existing output parent and a new destination:

```sh
systemd-run --user --scope --quiet \
  --property=MemoryMax=16G --property=MemorySwapMax=0 \
  --property=TasksMax=2048 /bin/bash -c \
  'npm ci --ignore-scripts && npm run publish:csharp -- --mode nativeaot --output /absolute/releases/csharp-nativeaot'
```

The publisher stages all products before renaming the completed directory.
It produces `crossfire/Crossfire.Server`, `fleetd/fleetd`, `fleet/fleet`, common
web/tool assets, licenses, the implementation README and `distribution.json`. The manifest
records implementation, mode, platform, coordinated version, tool release and
executable paths. Retain all files, including native dependency data/notices.

Local publication does not upload a release, publish npm packages or activate
an instance. No managed backend is embedded as a fallback. Only the Node
fleet/fleetd products may be public npm packages.

## Install and run the server

Copy the entire completed directory to its selected release location. Keep
sibling products and data together; do not merge over an active release.
For a new local instance:

```sh
/absolute/releases/csharp-nativeaot/crossfire/Crossfire.Server init \
  --directory /absolute/private/crossfire-state --instance team \
  --origin http://127.0.0.1:8098 --content-origin http://localhost:8099 \
  --server-name team.localhost --administrator admin
/absolute/releases/csharp-nativeaot/crossfire/Crossfire.Server start \
  --directory /absolute/private/crossfire-state --package /absolute/packages/csharp-nativeaot \
  --port 8098 --content-port 8099
```

Initialization refuses nonempty state. The initial password is in private
`bootstrap.json`, field `administratorPassword`. The operator validates ownership,
confirms removal of its owned container orphans, verifies any required upgrade
backup and runs Knex before the selected NativeAOT runtime image. Ctrl+C stops
the owned container and retains data. Build packages with the root
`npm run package:containers -- --output /absolute/packages` command first.
The package, not the operator's implementation, selects the server backend.
`--source`, `--compile` and `--runtime` are rejected.

The example serves Element at `http://127.0.0.1:8098/` and management at
`http://127.0.0.1:8098/manage/`. The separate content port serves committed
reports only. Public deployments need exact HTTPS origins, trusted ingress and
separate proxy routes. These example addresses are not live deployments.

## Install and connect fleet and fleetd

Retain the sibling `fleet` and `fleetd` directories. The CLI resolves the native
controller and `fleetd/artifacts` from that layout, not an npm installation.

```sh
export PATH="/absolute/releases/csharp-nativeaot/fleet:/absolute/releases/csharp-nativeaot/fleetd:$PATH"
fleet --help
fleet setup --descriptor 'https://example.test/onboarding/setup.json?ownerMatrixId=%40member%3Aexample.test'
fleet list
```

Use the actual personalized descriptor from management and its matching release.
Setup starts or reuses a private controller, creates a separate managed native
conversation and waits for human enrollment approval. The invoking assistant
remains independent. Optional `--root /absolute/private/controller` and
`--config /absolute/private/fleet/runtime.toml` use the shared loader.

Restore an existing controller with its original root:

```sh
fleet daemon start --root /absolute/private/controller
fleet daemon status --root /absolute/private/controller
```

Saved registry, activation and histories remain authoritative. Deliberately
stopped bindings stay stopped. No boot service is installed automatically.

## Upgrade and verify

Keep the exact source revision and distribution manifest. Back up private
server/controller/fleet state, credentials and native histories, including a
WAL-consistent management backup. Stop the old operator normally, then start
the selected new release against the same directory and explicit runtime.
The database remains the common Knex-created SQLite file.

Use the new CLI's `fleet update FLEET` or
`fleet agent update FLEET INSTANCE`, then restart fleetd with the same root.
Remote updates require the exact installed remote
`/absolute/releases/csharp-nativeaot/fleetd/artifacts` directory. Inspect outcomes,
effective settings, saved histories and prior enabled/stopped selection.

`fleet test FLEET` checks readiness without model input. From source, run the
following inside the same finite scope:

```sh
npm run verify:csharp
npm run verify:parity -- /absolute/new-evidence-directory
```

The C# bank executes actual managed and NativeAOT programs. The integrated bank
also runs Node/Rust, shared installed/browser/container behavior and migrations.
Passing fixed supported EF queries does not establish arbitrary dynamic query,
reflection or plugin support. Linux x64 inert-provider results do not certify
other hosts, paid models or all subprocess failure cases.

- [Shared product configuration and commands](https://github.com/control-flow-project/ctlflow/blob/main/services/fleet/docs/README.md)
- [Server configuration and backup](https://github.com/control-flow-project/ctlflow/blob/main/services/crossfire/docs/operations.md)
- [Dependency and verification limits](https://github.com/control-flow-project/ctlflow/blob/main/docs/architecture/native-implementations.md)
- [Proprietary license](https://github.com/control-flow-project/ctlflow/blob/main/LICENSE)

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
The installed server operator needs rootless Docker and a completed explicit
container package, not the checkout. Public deployment
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

Copy the entire completed directory to its selected release location. Retain
all sibling directories and runtime files; copying only an apphost is not an
installation. Do not merge new files over an active release directory.

For a new local instance:

```sh
/absolute/releases/csharp-managed/crossfire/Crossfire.Server init \
  --directory /absolute/private/crossfire-state --instance team \
  --origin http://127.0.0.1:8098 --content-origin http://localhost:8099 \
  --server-name team.localhost --administrator admin
/absolute/releases/csharp-managed/crossfire/Crossfire.Server start \
  --directory /absolute/private/crossfire-state --package /absolute/packages/csharp-managed \
  --port 8098 --content-port 8099
```

Initialization refuses nonempty state. The initial password is in private
`bootstrap.json`, field `administratorPassword`. The operator validates ownership,
removes only confirmed owned container orphans, verifies a required upgrade
backup, runs Knex, then starts the selected managed image. Ctrl+C stops the
owned container and retains data. Build packages with the root
`npm run package:containers -- --output /absolute/packages` command first.
The package, not the operator's implementation, selects the server backend.
`--source`, `--compile` and `--runtime` are rejected.

The example serves Element at `http://127.0.0.1:8098/` and management at
`http://127.0.0.1:8098/manage/`. The content port serves committed reports only.
Public deployments must configure their exact HTTPS origins, separate proxy
routes and trusted ingress. These example addresses are not live deployments.

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
fleet setup --descriptor 'https://example.test/onboarding/setup.json?ownerMatrixId=%40member%3Aexample.test'
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

Record the exact source revision and `distribution.json`. Back up server,
controller and fleet state, credentials and native histories; capture SQLite
through a WAL-consistent backup. Stop the old operator normally before starting
the new one with the same directory and explicit `--package` directory for the
managed C# backend.
All implementations open the same Knex-created database; changing backend is not
a reset or a second migration path.

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

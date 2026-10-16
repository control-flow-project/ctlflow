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
operator requires rootless Docker and an explicit verified container package.
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
Only the Node Fleet/fleetd products may be public npm packages.

Server image construction is separate from executable packaging. After the shared
Node build, the root command builds Node, managed C#, NativeAOT C# and Rust packages:

```sh
npm run package:containers -- --output /absolute/packages/release
```

Each backend directory contains `release.json`, `images.tar` and trusted build-side
`package-tool.mjs`. Copy the chosen complete package to the deployment host. The
archive contains its runtime and the common Knex image, selected by immutable IDs.

## Install and run the server

Copy the entire completed directory to its selected release location. Preserve
sibling products, native guards, timezone data and notices. Do not copy only the
three main executables or merge files over an active release.

For a new local instance:

```sh
/absolute/releases/rust/crossfire/crossfire init \
  --directory /absolute/private/crossfire-state --instance team \
  --origin http://127.0.0.1:8098 --content-origin http://localhost:8099 \
  --server-name team.localhost --administrator admin
/absolute/releases/rust/crossfire/crossfire start \
  --directory /absolute/private/crossfire-state --package /absolute/packages/release/rust \
  --port 8098 --content-port 8099
```

Initialization refuses nonempty state. The initial password is in private
`bootstrap.json`, field `administratorPassword`. The package selects its backend
independently of the operator language. Rust can run any verified backend package,
and Node/C# operators can run the Rust package. The operator verifies exclusive
ownership, archive bytes, image platform/release labels and exact owned orphan
cleanup, verifies a required upgrade backup and runs Knex before startup.
The superseded `--source`, `--compile` and `--runtime` flags are rejected.
There is no backend fallback. Ctrl+C stops the owned container and
retains persistent data.

The example serves Element at `http://127.0.0.1:8098/` and management at
`http://127.0.0.1:8098/manage/`. The separate content port serves report files
only. Public deployment needs exact HTTPS origins, trusted ingress and separate
proxy routes. These example addresses are not live deployments.

The image's native `health` command probes both application and Matrix readiness
over loopback with the configured public Host, three-second request bounds and no
redirects. It does not need Node, curl or a shell-based HTTP client in the Rust
runtime. Removal observes an already-removing exact container for at most two
minutes; failure to confirm absence blocks replacement.

## Install and connect Fleet and fleetd

Keep sibling `fleet` and `fleetd` directories together. The CLI resolves its
controller and `fleetd/artifacts` from that layout. The packaged process guard
must remain beside fleetd. It runs only while its owned native engine runs;
it is not another shared listener or a persistent service.

```sh
export PATH="/absolute/releases/rust/fleet:/absolute/releases/rust/fleetd:$PATH"
fleet --help
fleet setup --descriptor 'https://example.test/onboarding/setup.json?ownerMatrixId=%40member%3Aexample.test'
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

Record the exact source revision and distribution manifest. Back up server,
controller and fleet state, credentials and native histories, including a
WAL-consistent SQLite backup. Stop the old operator normally, then use the new
release with the same private directory. Knex is the only migration owner and
all implementations open the same database; changing backend is not a reset.

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

- [Shared product configuration and commands](https://github.com/control-flow-project/crossfire/blob/main/services/fleet/docs/README.md)
- [Server configuration and backup](https://github.com/control-flow-project/crossfire/blob/main/services/crossfire/docs/operations.md)
- [Architecture and verification limits](https://github.com/control-flow-project/crossfire/blob/main/docs/architecture/native-implementations.md)
- [Proprietary license](https://github.com/control-flow-project/crossfire/blob/main/LICENSE)

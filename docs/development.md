# Development and verification

Node.js 26+, npm 11.17+ and Git are required. The complete Node/C# parity gate
also needs the pinned .NET 11 SDK, GCC/AOT prerequisites and rootless Docker.
Install dependencies at the repository root:

```sh
systemd-run --user --scope --quiet \
  --property=MemoryMax=34359738368 --property=MemorySwapMax=0 \
  --property=TasksMax=8192 /bin/bash -c \
  'npm ci --ignore-scripts && npm run verify:parity -- /absolute/new-evidence-directory'
```

The root container gate creates one temporary, finite user slice with the
caller's verified memory, swap and task budget. Its test process, Docker build
steps and runtime containers all use that exact slice; Docker does not inherit
the calling CLI's cgroup. The gate verifies the slice and container parent and
stops only that private test slice on completion. No persistent/global unit,
daemon reconfiguration, production stack or fleet is touched. Run this gate
from the root, not directly through the service workspace command.
For a separately built distribution matrix, use
`npm run verify:container -- /absolute/implementation-matrix.json`.
See [shared contracts](verification/shared-contracts.md) for matrix creation,
standalone gates and the complete serialized verification order.

The lockfile and npm policy enforce engine versions, dependency age and disabled
implicit installation scripts. `.npmrc` keeps a seven-day minimum release age
with exact-name exclusions for the two verified public products,
`@ctlflow/fleet` and `@ctlflow/fleetd`, and the existing named Tinqer dependencies
`@tinqerjs/tinqer` and `@tinqerjs/better-sqlite3-adapter`. The public-product
exclusions allow installing a newly published pinned release on publication day.
They are not namespace wildcards: fresh nonexempt third-party packages and other private
`@ctlflow` names remain subject to the age policy. Installation lifecycle scripts
remain disabled; no controller/agent starts from npm hooks. The pinned
`better-sqlite3` 13.0.3 package includes a native binary verified to load on the
Linux development host with installation scripts disabled. Do not rebuild it
unconditionally. If the target platform has no usable bundled binary, install its
native C/C++ toolchain and explicitly run
`npm rebuild better-sqlite3 --build-from-source` inside the verified resource scope
before typecheck/build/tests. This Linux result does not remove the deployment
image's Alpine-specific build requirements. Root commands coordinate all three
services; `npm test` includes the shared build, so do not precede it with a
redundant `npm run build`. Do not add a global package pool.

## Test selection

Codex and Pi are implemented. There is no alternate-runtime test flag:
```sh
npm test
npm run test:browser
node scripts/test.mjs crossfire non-browser
node scripts/test.mjs fleetd non-browser
node scripts/test.mjs fleet non-browser
```

The non-browser selection excludes browser files only; it still includes native
Codex, Conduit and integration checks. It is useful when deployment must finish
before browser verification. Run the full gates afterward.

Tests use isolated processes across all available CPU cores. Build/typecheck
and pinned stock Element/Conduit/Pi extraction occur once per coordinated run.
Each native homeserver runs the image's unchanged static binary on loopback in
its test's resource scope, with an isolated RocksDB directory and one async
worker. Docker is not an unbounded execution escape for these native fixtures;
the container gate separately checks the actual deployment image and lifecycle.
Timing logic
uses injected clocks. Native I/O waits for bounded observable conditions, not
fixed-duration sleeps. Logs, per-file timings and summaries are written under
`.temp/test-runs/`.

The Linux runner verifies finite process-group memory, swap and task limits
before building or testing. The scope above allows 24 GiB and 4096 tasks for an
integrated run; size these finite limits to the host. For focused tests, use
`MemoryMax=4294967296`, `MemorySwapMax=0` and `TasksMax=512`. A heap limit alone
does not contain browser, native runtime and other child processes. Run each
test-selection command inside a verified scope; an unbounded runner fails closed.
This resource guard is Linux-specific and does not certify macOS test execution.

Browser fixtures use real HTTPS and trust only their pinned test certificate;
Node, .NET and curl child clients inherit that test authority. Production TLS verification
and Secure host-only cookie attributes are never relaxed for tests.

Default native tests require Codex 0.158.0+, Git, OpenSSH client/server, Chrome
and Docker. The runner prepares the verified native Pi 1.0.0 asset in disposable
test storage before workers; it never replaces a host installation. Its npm
dependency installation retains the repository's release-age policy and disabled
scripts. `CROSSFIRE_TEST_CODEX` selects Codex; `CROSSFIRE_BROWSER` selects Chrome.
Inert local providers establish protocol behavior, not paid-model quality or
untested-platform certification. Fixtures do not use production accounts.

## Ownership

Domain modules use ports and Result values, not transport or concrete adapters.
Composition roots wire functional adapters. Tinqer owns Node application queries;
EF Core owns C# queries over the identical Knex-created database;
raw SQL is reserved for schema and metadata. All product source and tests live
inside their owning service. Expected transaction failures roll back; native
operations stay outside database transactions.

Keep the specification, fixtures and generated release artifacts aligned.
Runtime settings are interpreted only by their runtime adapter. Preserve shared
work, credentials and production state. Deployment requires a verified backup
and forward migrations; no reset or schema-repair fallback exists.

## Public distributions

Only `@ctlflow/fleet` and `@ctlflow/fleetd` may be published. Root, Crossfire,
applications and internal modules are private. Internal package names follow
`@ctlflow/<service>-<module>`; declared package exports are the only reuse path.
Public tarballs contain standalone executables, finite allowlisted assets and
exact public dependency versions, not private-package registry dependencies or
monorepo source links. No installation script starts a controller or agent.

The Crossfire and both public product package versions must match exactly. The
setup descriptor derives its pinned Fleet version from the Crossfire package
version; Fleet's public daemon dependency uses that exact version, not a range.
Package gates reject inconsistent versions, private registry dependencies and
unapproved files. The controlled-registry installation gate covers the exact
named public age exclusions and still rejects fresh nonexempt dependencies.

The release checks pack and install the actual public artifacts in a clean
directory outside workspace resolution. They verify manifests, absence of
private dependencies/secrets, pinned tool bytes and installed commands. Registry
publication is a separate authenticated action after those checks; a successful
local pack is not a published release. npm setup is the sole user installation
path, not an alternative to an HTTP bootstrap installer.

After all gates pass, an operator with npm publishing authority for `@ctlflow`
packs the two explicit products and publishes the daemon before its pinned CLI:

```sh
umask 077
packages=$(mktemp -d)
npm whoami
npm pack ./services/fleetd --ignore-scripts --pack-destination "$packages"
npm pack ./services/fleet --ignore-scripts --pack-destination "$packages"
npm publish "$packages/ctlflow-fleetd-0.1.0.tgz" --access public --ignore-scripts
npm publish "$packages/ctlflow-fleet-0.1.0.tgz" --access public --ignore-scripts
```

Use the actual coordinated version's verified filenames when releasing another
version. Never publish all workspaces or an internal package. An authentication
failure is a publication dependency, not permission to bypass registry controls
or use another installation path. Publish both exact artifacts before deploying
Crossfire's matching npm setup descriptor. Publication acceptance and visible
version metadata are not sufficient: wait until both canonical public tarball
URLs return the complete archives with the verified pack integrity, and verify
a normal pinned npm install of the public pair before activating that descriptor.
Registry processing can expose metadata before its tarball is downloadable; hold
activation instead of adding another installer or bypassing registry controls.
Registry authentication may require a human; this is separate from zero-question
product setup and enrollment approval.

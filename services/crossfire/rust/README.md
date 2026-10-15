# Rust Crossfire, fleetd and fleet

The Rust workspace implements the same three products as Node and C#.
It uses the same React UI, API declarations, native tool assets and SQLite files.
There is no JavaScript backend embedded in or delegated to by a Rust executable.
Knex is the only schema/migration owner; Diesel is the Rust query owner.

## Build and verify

Linux x64, the pinned toolchain in `rust-toolchain.toml`, Node 26/npm 11.17,
the repository's .NET 11 pins, a native C toolchain and rootless Docker are needed
for the entire cross-language gate. Node is build/test tooling and the shared
Knex migration runtime; fleet agents' shared tools also use Node.

Run from the repository root inside a finite aggregate scope:

```sh
systemd-run --user --scope --quiet \
  --property=MemoryMax=16G --property=MemorySwapMax=0 \
  --property=TasksMax=2048 bash -c \
  'npm ci --ignore-scripts && npm run verify:parity -- /absolute/new-evidence-directory'
```

The combined gate runs all Node and native tests, both real native engines,
standalone installed-product contracts, browser checks, four-target containers
and the actual shared migration container. Paid models and production credentials
are not used. Focused Rust internal checks after installing/building shared
assets are `npm run test:rust`; they are not whole-product certification.

Build an independently runnable native distribution in the same resource scope:

```sh
npm run publish:rust -- --output /absolute/new-distribution-directory
```

The output contains `crossfire/crossfire`, `fleetd/fleetd`, `fleet/fleet`,
shared UI/onboarding assets, pinned timezone data, the required native process
guard, proprietary first-party LICENSE and actual third-party license/notice
files. `distribution.json` records exact version, platform and build profile.
Release is the default; `--profile debug` is an explicit verification build.
The publisher builds artifacts; it does not deploy, publish to a registry or
claim certification.

## Operation

- `crossfire init --directory /absolute/new-state --instance Example --origin https://example.test --content-origin https://content.example.test --server-name example.test --administrator admin`
  creates private configuration/bootstrap credentials, not an application schema.
  See `crossfire --help` for all explicit initialization options.
- `crossfire start --directory /absolute/state --source /absolute/source`
  builds/selects the Rust container and shared assets, stops its exact owned
  container, verifies a required pre-upgrade backup and runs shared Knex before
  starting the server. The one current container includes Conduit, Element,
  React, API and isolated static content. Site TLS/proxy deployment remains
  site-owned.
- `crossfire serve /absolute/prepared-state /absolute/release /absolute/web /absolute/element`
  opens only an already migrated database. It is the direct native host used by
  external contracts; optional application/content ports follow those arguments.
- `fleet setup` uses the personalized setup arguments from management. It
  asks no setup questions, retains identity/history and requires normal human
  enrollment approval.
- `fleetd --root /absolute/private-controller-root` owns the shared listener,
  Unix API and native engines. Fleet commands use that API even locally.
  SSH remains strict about approved host keys and exact remote socket identity.

The existing [fleet CLI guide](../../fleet/README.md) and
[fleetd guide](../../fleetd/README.md) describe shared configuration and lifecycle
semantics. Instances override role settings through the same validated model.
Codex and Earendil Pi are implemented; Claude is not a selectable placeholder.
Stopping/resuming retains saved native history and deliberate selections.
Only a confirmed explicit reset replaces history and exports currently authorized
Matrix context to private files first.

## Security, recovery and boundaries

Strict typed ports separate rules, persistence and concrete adapters. SQL is
typed Diesel except schema/metadata and backup maintenance. Expected failures
roll back; native work is outside database transactions. HTTP validates Host,
Origin, CSRF, signatures, exact bodies/query parameters and resource bounds.
Private files use owned descriptors, no-follow checks and exact-generation locks.
Static content uses the shared separate-origin/opaque-origin sandbox contract.

Native inputs retain exact durable receipts. Recovery never invents a new history
to hide a failed resume. Uncertain delivery carries the last retained message
explicitly. Accepted mentions steer immediately; quoted names are not controls.
Decisions and private visible terminal output go to owner DMs, never broadcast.
Large input uses the instance-wide configured inline threshold and private file
bundles. Historical Matrix export is paginated and current-access fenced.

Rust's small Linux process guard watches fleetd through pidfd and kills the
owned native group after unexpected parent exit. It is an adapter primitive,
not a second daemon/listener; it exits with its native engine. This does not
claim protection against privileged host compromise, kernel failure or
arbitrary adversarial subprocesses deliberately escaping their process group.

Architecture: [shared ownership](../../../docs/architecture/native-layout.md).
Verification and evidence limits: [Rust review](../../../docs/architecture/rust-review.md).

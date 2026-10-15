# C# implementation

The .NET 11 source implements Crossfire, fleetd and Fleet through the same public
contracts as Node. The React management UI and four intentional agent-tool assets
remain shared. Rust is a separate implementation/PR using the same contract suite.

The complete `verify:parity` gate builds both distributions and verifies Node,
managed C# and actual NativeAOT against the same external assertions, including
real containers. Current results, diagnostic dispositions and evidence limits
are recorded in the linked implementation-readiness report. No production
deployment or registry publication is implied by a local verification pass.

## Ownership

```text
services/
  crossfire/
    apps/web/                         one React UI
    database/management/sqlite/        one Knex schema/migration owner
    csharp/
      apps/Crossfire.Server/          HTTP, content server and operator
      packages/
        Crossfire.Kernel/             results and protocol values
        Crossfire.Contracts/          validation and REST metadata
        Crossfire.Domain/             functional application/policy modules
        Crossfire.AgentCore/          receiver, history, output and decisions
        Crossfire.AdapterCrossfire/   coordination and private tool host
        Crossfire.AdapterCodex/       native Codex protocol and histories
        Crossfire.AdapterPi/          native Pi RPC and common owned extension
        Crossfire.AdapterRuntime/     runtime ports and durable delivery
        Crossfire.AdapterFilesystem/  private state, locks and logging
        Crossfire.AdapterHttp/        bounded JSON/binary HTTP
        Crossfire.AdapterMatrix/      native Matrix HTTP
        Crossfire.AdapterProcess/     Linux process ownership
        Crossfire.AdapterSchedule/    calendar adapter
        Crossfire.AdapterSqlite/      EF model, queries and transactions
        Crossfire.AdapterToml/        strict native configuration
      build/                         build-only EF generator/startup host
      tests/                         internal acceptance
  fleetd/csharp/
    apps/Fleetd.Daemon/               private Unix HTTP composition
    packages/Fleetd.Contracts/        daemon and configuration contracts
    packages/Fleetd.Domain/           controller and native lifecycle
    packages/Fleetd.Storage/          registry, setup and restart state
    packages/Fleetd.AdapterExecution/ enrollment, execution and reset export
    tests/Fleetd.Domain.Tests/        controlled controller ownership transitions
  fleet/csharp/
    apps/Fleet.Cli/                   commands and noninteractive setup
    packages/Fleet.DaemonClient/      private daemon API client
    packages/Fleet.SshTransport/      authenticated SSH forwarding
```

The root solution/SDK/package metadata coordinates these service-owned projects.
Domain modules use typed ports, not transport, EF, UI or native implementations.
Framework boundaries and actual resource owners retain necessary classes/state.
Neither managed nor native executables call a Node backend as a fallback. The
common JavaScript agent IPC tool is intentional shared software, not a second
server/controller implementation.

Knex alone creates and migrates SQL application schemas. EF only validates/opens
the canonical SQLite file, with the same keys, indexes, rows and Knex metadata as
Node/Rust. No EF migration history or importer exists. Native engines own their
conversation stores; fleetd never rewrites native history. Private SQLite lock
files implement the common locking protocol, not application databases.

## Distributions

The pinned .NET 11 RC1 SDK, GCC/AOT prerequisites, Node 26+, npm and restored
dependencies are required. Set `DOTNET_EXECUTABLE` to the absolute SDK executable
if it is not on `PATH`. Build inside a finite aggregate Linux process-group scope.
To build distributions independently of the complete gate:

```sh
systemd-run --user --scope --quiet \
  --property=MemoryMax=32G --property=MemorySwapMax=0 --property=TasksMax=8192 \
  --working-directory=/absolute/path/to/crossfire \
  npm run publish:csharp -- --mode managed --output /opt/ctlflow/managed
systemd-run --user --scope --quiet \
  --property=MemoryMax=32G --property=MemorySwapMax=0 --property=TasksMax=8192 \
  --working-directory=/absolute/path/to/crossfire \
  npm run publish:csharp -- --mode nativeaot --output /opt/ctlflow/nativeaot
```

Use new output directories with existing owned parents. The builder stages all
three products and common assets, then renames the completed tree. Failure removes
staging, not existing installations. This builds files; it neither certifies a
release nor publishes to npm. Each distribution has:

```text
distribution.json
LICENSE
README.md
crossfire/Crossfire.Server
crossfire/web/
crossfire/onboarding/<release>/
fleetd/fleetd
fleetd/artifacts/
fleet/fleet
```

Managed outputs include their runtime/native apphosts; AOT outputs are actual
native executables. Keep the sibling product directories together: Fleet finds
its installed fleetd and matching tool assets there. Public CLI/controller builds
do not resolve private npm modules. The embedded Pi extension is generated from
the same authored extension as Node. First-party licensing remains proprietary.

## Operation

Use the existing commands, TOML and daemon API. Installed `fleet setup --descriptor
PERSONALIZED_SETUP_URL` starts its sibling controller without adopting the coding
session. Enrollment still requires the real human's approval. Model/effort
overrides, exact-history resume, saved stop selections, explicit fresh history and
owner decision tools retain the same contracts. SSH requires trusted host keys
and uses ordinary SSH authentication; no host service/global config is installed.

Crossfire's rootless-Docker operator uses the shared UI, Element, Conduit and
Knex assets. The selected implementation never migrates the schema itself:

```sh
/opt/ctlflow/nativeaot/crossfire/Crossfire.Server start \
  --directory /srv/private/crossfire \
  --source /absolute/path/to/crossfire --runtime nativeaot
```

`--runtime managed` explicitly selects the managed image. The operator stops the
owned old writer, verifies a backup when conversion is needed, runs the one-shot
Knex container, and activates only after success. Runtime and migration containers
have explicit ownership and cancellation cleanup. No production reset occurs.
Development `serve STATE RELEASE WEB ELEMENT [PORT] [CONTENT_PORT]` opens an
already migrated store against an already running Matrix homeserver.

Diagnostic and completed unpinned operation records use seven-day default
retention. Forward conversion produces one current operation/log/profile format.
Obsolete native context metadata requires the offline `fleetd --root ROOT
--migrate-contexts` command. Resume never guesses a new identity or fresh history.

## Verification

`verify:contracts` runs identical service-owned external scenarios against explicit
backend executable targets. C# requires Node plus managed and actual AOT outputs.
The separate Rust build joins the same suite when available. Every selected target
runs actual Codex and Pi with inert providers, actual pinned Conduit, unchanged
React, private daemon/CLI operations and same-file database reopening. Missing
configured binaries fail; reports identify exactly the tested implementations.

- [Shared matrix, commands and coverage](https://github.com/control-flow-project/crossfire/blob/main/docs/verification/shared-contracts.md)
- [Implementation status and evidence limits](https://github.com/control-flow-project/crossfire/blob/main/docs/architecture/native-implementations.md)
- [Canonical Knex databases and upgrade containers](https://github.com/control-flow-project/crossfire/blob/main/services/crossfire/database/README.md)

`npm run verify:csharp` runs managed/native core and runtime acceptance; focused
owner commands are `verify:csharp:core` and `verify:csharp:runtime`.
The core command also runs the service-owned controller state-transition tests
in managed and actual NativeAOT builds. These hold startup at an explicit barrier,
then stop an agent, stop its fleet or shut down the daemon; late native results
must be disposed before completion, and explicit resume retains the same history.
These are internal state-transition checks, not native-integration evidence.
All applicable Node, shared contract, browser/container, architecture, distribution, performance
and trim/AOT warning-audit gates remain mandatory. Initial managed deployment is
allowed after gates; it does not substitute for AOT execution. Native EF warnings
remain visible; their scope and disposition belong to the implementation-readiness
report. The pinned .NET/EF preview is an explicit framework limitation, not a
silent managed or Node fallback.

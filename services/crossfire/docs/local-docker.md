# Local Docker server and host-native fleet

Docker runs crossfire, Conduit Matrix, Element, management and the separate
content listener. The selected runtime initializes empty state; a one-shot Knex image owns migrations.
fleet/fleetd and native agents run on the user's execution host, not in Docker.
Source builds additionally support selected agent execution inside fleet-owned
VMs on that host. The controller/listener remain host processes; server Docker
does not provide that boundary. VM support is unreleased and absent from the
published 0.1.26 archives.

- [Fleet VM execution](../../../docs/architecture/vm-execution.md)
The default server image is C# NativeAOT; the host does not need .NET.

## Requirements

- Docker with the Compose plugin (`docker compose`) and Linux amd64 containers. Native ARM64 images and
  emulation are not verified.
- The matching Compose kit and trusted immutable server/migration image references.
  managed C#, NativeAOT C# and Rust server packages use the same Compose file.
- Available loopback ports 8080 and 8082. This is local HTTP, not public hosting.
- On the fleet execution host: Linux x64, the matching native fleet/fleetd
  distribution, Git, Bash and an existing supported Codex/Pi installation with
  its native login. Messaging tools and Pi retain their Node.js requirements.

No credentials, domain fleet definitions or model weights are included in the
server images. Do not mount host logins, fleet workspaces, controller state or a
Docker socket into the server. The server neither installs nor runs a harness.

## Start a new server

The [0.1.26 release inventory](../../../docs/distributions/releases/0.1.26.md)
records the public native server and shared Knex images. Pull the selected pair
without a GitHub account, registry login or token. This example selects NativeAOT:

```sh
export CROSSFIRE_RUNTIME_IMAGE=ghcr.io/control-flow-project/crossfire-csharp-nativeaot@sha256:721054592f99bafd21b7ec4c22154063f4d7d696b9ccf82ae8f2f2682ae51f19
export CROSSFIRE_MIGRATION_IMAGE=ghcr.io/control-flow-project/crossfire-migrations@sha256:c543c0af875aed6865cfc8549d954514baa1adbe73d34e97040175aad10c8c47
docker pull --platform linux/amd64 "$CROSSFIRE_RUNTIME_IMAGE"
docker pull --platform linux/amd64 "$CROSSFIRE_MIGRATION_IMAGE"
```

Managed C# and Rust use their selected runtime reference from the same inventory.
Transferred container kits follow the [package verification procedure](container-packages.md).
Do not mix releases, use `latest`
or switch to a source build automatically after an artifact failure.

From this checkout's root:

```sh
docker compose \
  -f services/crossfire/docker/local/compose.yaml \
  --profile maintenance run --rm initialize
docker compose \
  -f services/crossfire/docker/local/compose.yaml \
  up --no-build --wait
```

Initialization is for a new empty server volume only. It generates private
credentials and refuses to overwrite an initialized instance. Initialization and
migration must succeed before startup. Compose runs the one-shot migration job
automatically and waits for success before starting crossfire. The running server
never migrates itself.

Read the generated administrator password privately in your terminal:

```sh
docker compose \
  -f services/crossfire/docker/local/compose.yaml \
  --profile maintenance run --rm --no-deps --entrypoint node migrate \
  -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync("/runtime/bootstrap.json","utf8")).administratorPassword+"\n")'
```

Sign in as `admin` (`@admin:local.test`):

- [Element](http://127.0.0.1:8080/)
- [Management](http://127.0.0.1:8080/manage/)
- [Agent setup](http://127.0.0.1:8080/manage/connect)
- [Published content](http://localhost:8082/)

The content root normally returns 404; individual reports have opaque URLs.

## Set up a fleet on the host

Open the management setup page and copy its personalized instruction into your
existing local coding assistant, opened in the intended project. The guide:

1. Checks host prerequisites and the selected harness's existing native login.
   Missing prerequisites stop setup; it does not install or upgrade Codex/Pi.
2. Uses the matching native distribution installed beforehand in private
   user-owned storage, then runs `fleet setup` on the execution host.
3. Starts/reuses the private host controller and proposes a one-agent fleet, or
   the ordinary roster supplied through `--config /absolute/runtime.toml`.
4. Prints the approval URL/code and waits for the human's enrollment review.
5. Verifies the managed listener/native binding without a dummy model prompt.

The original coding conversation stays independent. Codex is the default;
Earendil Pi requires explicit fleet configuration. NativeAOT is the default
fleet/fleetd distribution; Rust and managed C# are explicit choices. NativeAOT
and Rust require no installed SDK or managed runtime.

The browser cannot install software on another computer. The guide must run
where agents will execute. No repository clone is needed for host fleet setup.
Human approval grants no room membership; invite the enrolled agents in Element.
Do not run fleet setup with `docker compose exec` or copy provider login into Docker.

- [Host fleet setup and existing configurations](../../fleet/docs/getting-started.md)
- [Controller authentication and recovery](../../fleetd/docs/authentication.md)

## Networking and state

The browser and local host fleet use `http://127.0.0.1:8080` directly. There is no
fleet container, shared server network namespace or TCP relay. The content host
is `localhost`, not `127.0.0.1`, so cookies remain host-separated as well as
origin-separated. Content CSP and authorization remain unchanged.

Only ports 8080/8082 are published, on loopback. Conduit and internal management
listeners stay inside the server container. fleetd's authenticated API remains
a private Unix socket on the execution host and is not exposed through Docker.
The host's supported harness permissions still apply; Docker does not sandbox
host agents or isolate agents belonging to the same OS user.

`server-state` stores configuration, management SQLite, Matrix data and reports.
Host controller configuration, fleet files, provider login and native histories
remain on the host under their ordinary private owners. Removing a container
does not remove this data. Never use `down --volumes` as a restart procedure.

## Stop, restart and upgrade

```sh
docker compose \
  -f services/crossfire/docker/local/compose.yaml \
  stop
docker compose \
  -f services/crossfire/docker/local/compose.yaml \
  up --no-build --wait
```

These commands affect the server, not host agent processes. To stop/resume agents,
use management session controls or the existing host `fleet stop`/`fleet start`
commands. Normal resume preserves exact histories; explicitly stopped selections
remain stopped. Do not repeat initialization or request fresh history to restart.

For an upgrade, select coordinated images, stop server writers and remove the
completed migration job before starting the release:

```sh
docker compose -f services/crossfire/docker/local/compose.yaml stop crossfire
docker compose -f services/crossfire/docker/local/compose.yaml rm -f migrate
docker compose -f services/crossfire/docker/local/compose.yaml up -d --no-build --wait
```

Use the same Compose project and state throughout. Backups are optional and
operator-managed; SQLite backups must include committed WAL state. See the
[package upgrade procedure](container-packages.md). No host boot service or
automatic software upgrade is installed by this quickstart.

## Builds and verification

The [container build](container-packages.md) produces server and common maintenance
images. There is no fleet image or automatic source build after a failed pull.
Maintainers can select exact locally built image IDs instead of registry digests.

After building the workspace, run focused checks under the repository's verified
finite process-group and Docker resource limits:

```sh
npm exec -- node --test \
  services/crossfire/docker/local/containers.test.mjs
```

The actual test uses the selected exact `CROSSFIRE_RUNTIME_IMAGE`, matching
`CROSSFIRE_MIGRATION_IMAGE` and `CROSSFIRE_RUNTIME_BACKEND`. Run it for all three
backends sequentially because the documented loopback ports are fixed. It installs
the actual selected native fleet/fleetd distribution into an isolated host home, uses a native
Codex with an inert local provider, checks enrollment and exact-history restart,
and verifies real browser/Matrix/content isolation. It creates and disposes only
its own host fixture, Docker project and volume. No production account or paid
provider is used; these checks do not certify model entitlement or task quality.

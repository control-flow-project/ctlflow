# Local Docker server and host-native fleet

Docker runs crossfire, Conduit Matrix, Element, management and the separate
content listener. A one-shot image owns initialization and Knex migrations.
fleet/fleetd and native agents run on the user's execution host, not in Docker.
The default server image is C# NativeAOT; the host does not need .NET.

## Requirements

- Docker with Compose v2 and Linux amd64 containers. Native ARM64 images and
  emulation are not verified.
- The matching checkout and trusted immutable server/migration image references.
  Node, managed C#, NativeAOT C# and Rust server packages use the same Compose file.
- Available loopback ports 8080 and 8082. This is local HTTP, not public hosting.
- On the fleet execution host: Linux/macOS, Node.js 26+, npm 11.17+, Git, Bash
  and an existing supported Codex or Pi installation with its native login.

No credentials, domain fleet definitions or model weights are included in the
server images. Do not mount host logins, fleet workspaces, controller state or a
Docker socket into the server. The server neither installs nor runs a harness.

## Start a new server

Select a current coordinated runtime and migration package as described in
[container packages](container-packages.md). Set `CROSSFIRE_RUNTIME_IMAGE` and
`CROSSFIRE_MIGRATION_IMAGE` to its verified immutable image references. Registry
references use `ghcr.io/control-flow-project/<image>@sha256:<manifest-digest>`;
local imported packages use their verified Docker image IDs. Do not use `latest`
or mix releases. Registry credentials stay on the host outside containers.

The current source is 0.1.23. The retained published 0.1.22 inventory is historical,
not a current-contract quickstart. No 0.1.23 registry digest is claimed here;
build the current package or obtain verified current references from its publisher.

```sh
: "${CROSSFIRE_RUNTIME_IMAGE:?Set the verified current runtime image reference}"
: "${CROSSFIRE_MIGRATION_IMAGE:?Set its matching current migration image reference}"
```

From this checkout's root:

```sh
docker compose \
  -f services/crossfire/docker/local/compose.yaml \
  --profile maintenance run --rm initialize
docker compose \
  -f services/crossfire/docker/local/compose.yaml \
  --profile maintenance run --rm migrate
docker compose \
  -f services/crossfire/docker/local/compose.yaml \
  up --no-build --wait
```

Initialization is for a new empty server volume only. It generates private
credentials and refuses to overwrite an initialized instance. Initialization and
migration must succeed before startup. The running server never migrates itself.

Read the generated administrator password privately in your terminal:

```sh
docker compose \
  -f services/crossfire/docker/local/compose.yaml \
  --profile maintenance run --rm --no-deps --entrypoint node initialize \
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
2. Installs pinned `@ctlflow/fleet` and its exact `@ctlflow/fleetd` dependency in
   private user-owned storage, then runs `fleet setup` on the execution host.
3. Starts/reuses the private host controller and proposes a one-agent fleet, or
   the ordinary roster supplied through `--config /absolute/runtime.toml`.
4. Prints the approval URL/code and waits for the human's enrollment review.
5. Verifies the managed listener/native binding without a dummy model prompt.

The original coding conversation stays independent. Codex is the default;
Earendil Pi requires explicit fleet configuration. Node fleet/fleetd are used
regardless of the server backend. No host-side .NET or Rust is required.

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

For an upgrade, stop server writers, verify a private backup, select coordinated
images, run the matching one-shot migration and restart the server. Back up host
fleet state separately before updating fleet/fleetd. See the
[package upgrade procedure](container-packages.md). No host boot service or
automatic software upgrade is installed by this quickstart.

## Builds and verification

The [container build](container-packages.md) produces server and common maintenance
images. There is no fleet image or automatic source build after a failed pull.
Maintainers can select exact locally built image IDs instead of registry digests.

After building the workspace, run focused checks under the repository's verified
finite process-group and Docker resource limits:

```sh
node --test \
  services/crossfire/dist/tests/local-docker.test.js
npm exec -- node --test \
  services/crossfire/docker/local/containers.test.mjs
```

The actual test uses the selected exact `CROSSFIRE_RUNTIME_IMAGE`, matching
`CROSSFIRE_MIGRATION_IMAGE` and `CROSSFIRE_RUNTIME_BACKEND`. Run it for all four
backends sequentially because the documented loopback ports are fixed. It installs
the actual local fleet/fleetd archives into an isolated host home, uses a native
Codex with an inert local provider, checks enrollment and exact-history restart,
and verifies real browser/Matrix/content isolation. It creates and disposes only
its own host fixture, Docker project and volume. No production account or paid
provider is used; these checks do not certify model entitlement or task quality.

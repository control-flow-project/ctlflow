# Local Docker quickstart

This runs the existing crossfire server image (Conduit Matrix, Element,
management UI and the separate content listener) and a Node fleetd container.
The server default is the C# NativeAOT package. No .NET installation is needed
on the host. The calling setup assistant remains independent.

## Prerequisites

- Docker with Compose v2 and Linux amd64 containers. Native ARM64 images are not
  provided; Docker Desktop on another CPU would require unverified emulation.
- Trusted immutable GHCR references for the coordinated C# NativeAOT server,
  common migration image and Node fleet image, and this matching source checkout.
- Loopback ports 8080 and 8082 available. This is local-only HTTP, not a public
  deployment. Do not change the bindings to `0.0.0.0`.
- Your own supported provider login. No credentials are included in either image.

The fleet image contains the coordinated Node fleet/fleetd archives. Its build
installs Codex 0.162.0 and Earendil Pi 1.0.0 using the repository's
npm age policy. The build verifies the required Codex developer-instruction RPC,
structured-question feature and Pi version through the existing adapter checks.
Missing capabilities fail the build; another executable is never substituted.

## First start

Use the three complete `@sha256:` references supplied by the trusted release
publisher. The examples below contain placeholders, not published digests.
Authenticate to GHCR on the host if the selected packages require it; registry
credentials are not mounted into either container. Do not mix releases.

```sh
export CROSSFIRE_RUNTIME_IMAGE=ghcr.io/control-flow-project/crossfire-csharp-nativeaot@sha256:RUNTIME_MANIFEST_DIGEST
export CROSSFIRE_MIGRATION_IMAGE=ghcr.io/control-flow-project/crossfire-migrations@sha256:MIGRATION_MANIFEST_DIGEST
export CTLFLOW_FLEET_IMAGE=ghcr.io/control-flow-project/fleetd-node@sha256:FLEET_MANIFEST_DIGEST
docker pull "$CROSSFIRE_RUNTIME_IMAGE"
docker pull "$CROSSFIRE_MIGRATION_IMAGE"
docker pull "$CTLFLOW_FLEET_IMAGE"
```

From this checkout's root:

```sh
docker compose -f services/crossfire/docker/local/compose.yaml --profile maintenance run --rm initialize
docker compose -f services/crossfire/docker/local/compose.yaml --profile maintenance run --rm migrate
docker compose -f services/crossfire/docker/local/compose.yaml up --no-build --wait
```

Initialization is only for a new empty server volume. It generates private
credentials. It refuses an initialized volume rather than replacing anything.
The migration service is the existing one-shot Knex image. The runtime never
creates or migrates a schema. A failed initialization or migration must be
resolved before running `up`.

Read the generated administrator password privately on your own terminal:

```sh
docker compose -f services/crossfire/docker/local/compose.yaml --profile maintenance run --rm --no-deps --entrypoint node initialize -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync("/runtime/bootstrap.json","utf8")).administratorPassword+"\n")'
```

Sign in as `admin` (`@admin:local.test`):

- [Element](http://127.0.0.1:8080/)
- [Management](http://127.0.0.1:8080/manage/)
- [Published content](http://localhost:8082/)

The content root normally returns 404; agents publish individual opaque links.

## Provider login and fleet enrollment

For Codex, complete its normal device login inside the fleet container:

```sh
docker compose -f services/crossfire/docker/local/compose.yaml exec fleetd codex login --device-auth
```

For Pi, run `exec fleetd pi`, then use Pi's native `/login`. Private native
configuration can be edited inside the container at `/home/node/.codex/config.toml`
or `/home/node/.pi/agent/models.json`. Do not paste provider credentials into
rooms or instructions. These files belong to the container's `node` user.
Configure exact provider/model settings through the ordinary fleet definition
when native defaults do not match your account. Unavailable models fail normally.

Open Management's setup page, copy its personalized descriptor URL and run the
ordinary command inside the container; substitute your actual descriptor:

```sh
docker compose -f services/crossfire/docker/local/compose.yaml exec fleetd fleet setup --root /home/node/.ctlflow/controller --descriptor 'http://127.0.0.1:8080/onboarding/setup.json?ownerMatrixId=%40admin%3Alocal.test'
docker compose -f services/crossfire/docker/local/compose.yaml exec fleetd fleet --root /home/node/.ctlflow/controller list
```

Complete the human enrollment review in Management. Running a local container
does not approve enrollment or grant room membership. Setup starts separate
managed native histories; it never adopts the process/history running setup.

## Networking and isolation

The containers have separate network namespaces. Two ordinary raw TCP relays
inside the fleet container forward its own loopback ports 8080/8082 to the
server's public listeners. Consequently the exact public origin
`http://127.0.0.1:8080` works from both the host browser and fleetd. The relays do
not parse HTTP, rewrite headers or bypass origin/authentication checks. There is
one public API path. HTTP names such as `crossfire.localhost` are not admitted by
the current origin contract; no exception or local TLS layer is introduced.
The content host is deliberately **localhost**, not **127.0.0.1**: browser
cookies and local storage remain host-separated in addition to port-separated
origins. Existing content CSP, cookie and CSRF rules are unchanged.

Only the two loopback ports are published. The Conduit listener binds only the
**server's** private loopback port 6167. The fleet container cannot reach it and
has no relay to it; sharing the server network namespace would bypass crossfire's
Matrix interception and is prohibited. The fleet container also cannot read
the separate server-state volume. fleetd's authenticated API
remains a private Unix socket; no fleet API port or Docker socket is mounted.
Containers are read-only apart from their volumes and bounded temporary storage,
with capabilities dropped and no privilege escalation. This does not sandbox
one agent from another within the same owner-controlled fleet container.

## Stop, resume and data

```sh
docker compose -f services/crossfire/docker/local/compose.yaml stop
docker compose -f services/crossfire/docker/local/compose.yaml up --wait
```

Normal stop/start uses the same named volumes. Desired-active agents resume
their exact saved native histories; deliberately stopped agents remain stopped.
Do not repeat `initialize`, use `--fresh-history`, or remove volumes to restart.
To stop only an agent, use the existing `fleet agent stop` command or Management.

`server-state` holds the server configuration, SQLite, Matrix and publications.
`fleet-home` holds the private OS-user fleetd key, controller registry/intent,
workspaces, provider login and native histories. Both persist when containers are
recreated or `docker compose down` is run without `--volumes`. The fleet image
runs as UID/GID 1000; Docker initializes its home volume from the image's owned
private home. Do not replace it with a root-owned bind mount or mount your whole
host home. Back up these volumes privately before upgrading. Never commit them.

For an upgrade, stop both services, verify a private backup and follow the
[existing package upgrade procedure](container-packages.md) with matching images
and the one-shot migration before restarting. Do not run migrations while the
server is writing. Compose restarts the dependent fleet container when it
replaces the server. This quickstart does not install host boot services or
perform automatic upgrades.

## Source builds

Maintainers use the existing [container build](container-packages.md) for the
server and migration images. Set their exact local image IDs from the verified
package, explicitly select a local `CTLFLOW_FLEET_IMAGE` tag, then run
`docker compose -f services/crossfire/docker/local/compose.yaml build fleetd`.
This builds the same fleet Dockerfile used for registry publication. There is
no second server implementation, migration owner or automatic build after a
failed pull.

## Focused verification

Under the repository's finite test-resource scope, run the asset checks:

```sh
node --test services/crossfire/dist/tests/local-docker.test.js
node --test services/fleetd/docker/node/container.test.mjs
```

The actual-container check uses prebuilt exact server/migration image IDs and a
locally built fleet image. It creates and removes only its unique test project
and test volumes, using invented identities. It does not use production data or
call a paid model provider:

```sh
node --test services/crossfire/docker/local/containers.test.mjs
```

Set the exact `CTLFLOW_FLEET_IMAGE` for the independent fleet-container check.
Set `CROSSFIRE_RUNTIME_IMAGE`, `CROSSFIRE_MIGRATION_IMAGE` and
`CTLFLOW_FLEET_IMAGE` for the complete local-stack check. Tests require the repository's verified cgroup-v2
Docker resource controls; they are not an unbounded Docker Desktop test recipe.
Paid-provider login and task quality are separate acceptance requirements.

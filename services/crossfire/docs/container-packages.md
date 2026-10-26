# Container deployment packages

crossfire packages a selected server backend and the common Knex migration image.
For a local Docker server and host-native fleet, see the [local Docker quickstart](local-docker.md).
The deployment host needs rootless Docker with Compose. Trusted package
verification/export tooling requires Node.js 26; the server backend does not
require a host language runtime or a source checkout. All four backends use the
same Compose definition and one-shot migration dependency.

Build targets are Node, C# managed, C# NativeAOT and Rust on Linux amd64.
The Rust image contains its native server, not a substituted Node process.
These packages do not provide native macOS/Windows fleetd or ARM64 images.
C# fleetd currently has Linux-specific process/filesystem adapters.
Image construction and native calendar verification compile the same pinned IANA
archive from assets/time-zones.json; the host's installed database is not an input.

## Build

From the repository root, with the pinned build dependencies:

```sh
npm run package:containers -- --output /absolute/new-packages
```

An optional `--cgroup-parent EXISTING.slice` selects an existing bounded Docker
slice. Verification always supplies its verified finite resource slice. The build
constructs cached common assets/migrations, then the four runtime images:

```text
new-packages/
  node/{release.json,images.tar,package-tool.mjs,compose.yaml}
  csharp-managed/{release.json,images.tar,package-tool.mjs,compose.yaml}
  csharp-nativeaot/{release.json,images.tar,package-tool.mjs,compose.yaml}
  rust/{release.json,images.tar,package-tool.mjs,compose.yaml}
```

Each directory transfers independently. The archive contains one runtime image
and the same shared migration image. Build inputs are fingerprinted, including
the pinned policies/compiler files, and rechecked before the output is published.
Failed construction removes only its own staging output. No registry is contacted
for publication. A moderate-or-higher production dependency audit blocks image
construction, in the producer and common Docker build stage. Sites consume those
reviewed artifacts rather than maintaining private dependency/source overlays.
Docker may obtain pinned build dependencies/base images.
First-party code in these packages is MIT-licensed; dependencies retain their
separate licenses and notices.
The bundled package-tool.mjs is trusted Node.js 26 maintenance tooling for verifying
and exporting branded derivatives without a source checkout. It is not executed
by the server. A site activation script can run its
pure `identities` command in the shared migration image without installing Node
or mounting a Docker socket. Trust its publisher as executable
code; the archive checksum is not authentication of this helper.

## Format and image contract

The [published 0.1.24 release](releases/0.1.24.md) provides immutable references for
the generic images under
`ghcr.io/control-flow-project/crossfire-node`, `crossfire-csharp-managed`,
`crossfire-csharp-nativeaot`, `crossfire-rust` and `crossfire-migrations`.
These are server images; fleet/fleetd and native agents run on the execution host,
not in Docker. Publish a coordinated version only after its applicable gates
pass. Do not overwrite an existing version with different bytes or publish
site-specific source, instructions, data, configuration or credentials.
Record the registry manifest digest separately from Docker's local image ID;
they identify different objects. Consumers use complete immutable references,
not an automatically updated `latest` tag. Registry publication does not replace
the matching-release checks or one-shot migration requirement.

`release.json` is a UTF-8 JSON object of at most 8192 bytes. It has exactly:

| Field | Meaning |
| --- | --- |
| schemaVersion | Number 2; superseded package formats are rejected |
| version | Coordinated product version |
| sourceDigest | Lowercase SHA-256 of the crossfire build input |
| backend | Explicit backend slug, such as node or csharp-nativeaot |
| platform | linux/amd64 |
| archiveSha256 | Lowercase SHA-256 of images.tar |
| runtime | Runtime image object |
| migration | Different common Knex image object |

Each image object has exactly `reference`, `configDigest` and `descriptorDigest`.
The reference is a package-owned `crossfire-package:` transport tag with a
64-character lowercase hexadecimal suffix. The two SHA-256 digests identify the
actual OCI configuration and root descriptor stored in the archive. They are
different OCI objects, not alternative package schemas. The producer saves named
references so the OCI index retains both images; saving untagged IDs can lose
the second index entry.

Docker's current classic and containerd image stores expose different objects as
their native image ID. The package tool verifies the current store's
exact configuration or descriptor identity, plus platform and release labels,
then execute its immutable native handle. A malformed descriptor is rejected;
there is no retry using another identity, old schema reader or host-store change.
Registry manifests and configuration digests are also distinct in
[Docker's manifest documentation](https://docs.docker.com/reference/cli/docker/manifest/).

`images.tar` is a regular Docker-save archive, nonempty and at most 16 GiB.
The package tool verifies the archive even when images are cached, loads it when
required, and inspects exact OCI identities/platform/labels. Run verification
before stopping any current writer.
`package-tool.mjs verify DIR` emits `{package, runtimeImage, migrationImage}`:
the package definition and the two resolved immutable handles on that host.
`package-tool.mjs identities DIR` accepts the ordered runtime/migration output
of `docker image inspect` on stdin, validates the same identities and labels,
and emits the two handles separated by one space. It does not access Docker,
write state or validate the archive; activation must verify the archive digest
and load it before calling this pure inspection command.
Required labels are org.crossfire.package=1, org.opencontainers.image.version,
org.crossfire.source and org.crossfire.backend. The migration backend is migrations;
its version/source must equal the selected runtime. A package has no mutable tag
selection, source-build mode or automatic backend fallback.

Hashes establish exact bytes, not publisher authentication. Obtain the complete
directory from a trusted release publisher; changing both the archive and manifest
does not become trustworthy merely because their hashes agree.

Every runtime image owns its entrypoint, Conduit, Element, management UI, agent
tools, time-zone data and Docker health check. Runtime ports are 8080/8082 and
private state is mounted at /runtime. Images run read-only with a bounded /tmp,
dropped capabilities and no-new-privileges. Neither deployment projects nor the
operator inject a Node-based health check. The AOT image contains no Node or CLR
dependency; the managed image contains its required .NET runtime.

## Deploy or switch backends

Retain existing private state and configuration. Trust the package publisher,
then verify/import the selected backend package before stopping any writer:

```sh
node /absolute/packages/csharp-nativeaot/package-tool.mjs verify \
  /absolute/packages/csharp-nativeaot > /absolute/private/verified-images.json
export CROSSFIRE_RUNTIME_IMAGE=$(jq -r .runtimeImage /absolute/private/verified-images.json)
export CROSSFIRE_MIGRATION_IMAGE=$(jq -r .migrationImage /absolute/private/verified-images.json)
export CROSSFIRE_STATE=/absolute/private/state
export CROSSFIRE_PORT=8080 CROSSFIRE_CONTENT_PORT=8082
```

The maintenance tool needs Node.js 26 and the example extraction uses jq. The
returned image handles are immutable on the receiving Docker engine. Registry
consumers can instead pull the exact matching published digests; both artifact
transports feed the same Compose workflow. A failed pull or verification stops
there, without switching transport or backend automatically.

For a NEW empty state directory, set its identity and initialize once:

```sh
export CROSSFIRE_INSTANCE=team CROSSFIRE_SERVER_NAME=example.test
export CROSSFIRE_ORIGIN=https://example.test
export CROSSFIRE_CONTENT_ORIGIN=https://content.example.test
export CROSSFIRE_ADMINISTRATOR=admin
docker compose -p team -f /absolute/packages/csharp-nativeaot/compose.yaml \
  --profile maintenance run --rm initialize
```

For an initialized instance, or after that initialization:

```sh
docker compose -p team -f /absolute/packages/csharp-nativeaot/compose.yaml stop crossfire
docker compose -p team -f /absolute/packages/csharp-nativeaot/compose.yaml rm -f migrate
docker compose -p team -f /absolute/packages/csharp-nativeaot/compose.yaml up -d --no-build --wait
```

Use the same project name and state for every command. Compose starts the runtime
only after the migration job succeeds. On an upgrade, stop writers and remove
the completed job to guarantee a fresh run; dependency ordering alone does neither.
Inspect `docker compose ... logs migrate` after a failure and correct it before
retrying. Backups are optional and operator-managed. If taking one, include
committed SQLite WAL state, private configuration, credentials and other owned
persistent data. Do not delete volumes to recover a failed migration.

The default state is the project's named `server-state` volume. An absolute
CROSSFIRE_STATE selects a private bind directory instead. Ports default to
8080/8082 on loopback; public HTTPS and ingress remain site-owned. Use an explicit
Compose override for site resource/networking policy. The image owns its
entrypoint and readiness; do not inject backend-specific probes.

Switching packages changes the selected backend while retaining current SQL
data, Matrix rooms, credentials and publications. Native agent processes and
histories remain fleetd-owned. There is no `crossfire start` Docker operator,
automatic backend fallback, schema downgrade or data reset.

GAAP and Bad Bets select csharp-nativeaot in their site deployment profiles and
retain their separate DNS/TLS/nginx, origins, ports, private
directories and branding. A package is site-independent. This documentation is
not a record that either site's deployment scripts or running services changed.

## Site branding

Brand Element in a build stage with the site's own Node tooling, then copy only
the resulting assets into the selected runtime image. Do not run `node` inside
the final C#/Rust image, copy a Node runtime into it or hardcode an implementation
entrypoint/health probe in site Compose. The shared Element location is /app/element.
Preserve the base image's crossfire release labels, entrypoint and health check;
put site-specific provenance in site-owned labels.

After building the derivative image, use its immutable ID and the matching common
migration ID to create the same package format:

```sh
node /absolute/packages/csharp-managed/package-tool.mjs export \
  --runtime sha256:RUNTIME_IMAGE_ID \
  --migrations sha256:MIGRATION_IMAGE_ID \
  --output /absolute/new-site-package
```

The two IDs must be complete 64-character lowercase digests. This export function
also packages ordinary build outputs; it is not another deployment path. It checks
the inherited release labels and refuses mismatched runtime/migration releases.
Site-specific initialization uses the common maintenance image or Compose
initialize service, never application-source imports from a selected runtime. Configuration
updates must be validated outside language-specific image internals. All SQL
changes remain in the shared Knex image, never EF/Node runtime startup.

The common migration image also contains supported maintenance commands. It is
Node build/maintenance tooling, not a language fallback inside an AOT runtime:

```sh
docker run --rm --network none --mount type=bind,source=/absolute/private/state,target=/runtime \
  --entrypoint node sha256:MIGRATION_IMAGE_ID /app/services/crossfire/crossfire init \
  --directory /runtime --instance NAME --origin https://SITE --content-origin https://CONTENT \
  --server-name SITE --administrator USERNAME
```

Use init only on a new empty directory. On existing state, run
`/app/services/crossfire/dist/scripts/container-configuration.js` in that same
maintenance image with `--directory`, `--instance`, `--origin`, `--content-origin`
and `--server-name`, mounting state read-only. It validates without rewriting or
printing secrets. Then use the same Compose project to stop writers, remove the completed migrate
job and start the selected release. Backups remain operator-managed. Apply the documented
read-only filesystem, dropped-capability, no-new-privileges and resource controls
to maintenance containers as well.

Fleet instructions always recommend the pinned Node @ctlflow/fleet and Node
fleetd, including when either server backend is C#. The coding harness runs setup
as an operator; fleetd starts separate sessions. No .NET installation is added to
fleet attachment and no existing coding conversation is adopted.

## Verification and Rust integration

The shared actual-container bank builds packages once and then runs identical
API/UI/data assertions on each backend. It uses the same Compose kit, runs
image-owned readiness probes, tests transfer/import and rejects
corrupt archives/mismatched labels before touching a running instance.
The installed-products and current-schema migration banks remain required.

The root packaging coordinator composes the unchanged Node/C# builder with the
Rust-owned image producer. Rust reuses the common asset/migration Dockerfile,
package exporter and label validation; only its runtime build is target-owned.
The same container assertion bank covers all selected distributions. Rust's
separate release gate runs its actual image through this bank; the full matrix
uses the same deployment assertions for all backend packages. A passing build is not
an end-to-end certification; current evidence and unresolved owner findings are
recorded in the native review.

- [Historical Rust integration review](../../../docs/verification/20261017-rust-integration-review.md)

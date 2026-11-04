# Installation and packaging

Choose one implementation for each product. All implementations use the same
management UI, HTTP contracts and Knex-created SQLite database. C# managed and
C# NativeAOT are two build modes of the same implementation.

Docker runs the server side only. Install the matching native distribution on the
execution host before running the personalized management setup command. Setup
uses the existing Codex/Pi installation and login, does not install a harness and
does not move credentials into Docker. NativeAOT is the default; managed C# and
Rust are explicit selections of the same current contract.

- [Local Docker server and host-native fleet](../../services/crossfire/docs/local-docker.md)
- [0.1.25 server and migration release inventory](releases/0.1.25.md)

| Target | Server installation | Fleet/controller installation | Build command |
| --- | --- | --- | --- |
| C# managed | Self-contained Linux x64 directory | Sibling native apphost directories, with the .NET runtime included | `npm run publish:csharp -- --mode managed --output /absolute/new-directory` |
| C# NativeAOT | Native Linux x64 directory | Sibling compiled executable directories | `npm run publish:csharp -- --mode nativeaot --output /absolute/new-directory` |
| Rust | Native Linux x64 directory | Sibling compiled executable directories | `npm run publish:rust -- --output /absolute/new-directory` |

- [C# managed installation and packaging](csharp-managed.md)
- [C# NativeAOT installation and packaging](csharp-nativeaot.md)
- [Rust installation and packaging](rust.md)

Each guide covers prerequisites, packaging, server startup, fleet setup, upgrades
and verification. Each native publisher copies its selected target/mode guide
into the distribution as `README.md`. No installed guide requires a local source checkout merely to
resolve its documentation links.

`publish:csharp` and `publish:rust` write local directories. They do not upload
releases, install host services, publish npm packages or activate an instance.
All npm workspaces are private. crossfire and all
internal packages remain private. Native release archives and SHA256SUMS are
published as ordinary GitHub release assets; the selected target guide describes
download and extraction. There is no custom download or installation service.

Build dependencies and runtime dependencies differ. Native fleet controllers
still require Node for the shared agent-tool client; selecting a native backend
does not remove that requirement. Building runtime and migration images requires
a source checkout. Deployment uses the completed explicit Docker package; a
native server operator does not need the checkout or copy its host executable
into a container.

- [Shared product configuration](../../services/fleet/docs/configuration.md)
- [Development and all-target verification](../development.md)
- [Native architecture and limitations](../architecture/native-implementations.md)
- [Server backup and upgrade procedure](../../services/crossfire/docs/operations.md)

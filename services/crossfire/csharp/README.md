# C# products

C# implements the same crossfire, fleetd and fleet contracts as Node.
It targets .NET 11 and produces managed and NativeAOT output from the same source.
The React UI, agent tools, Pi extension and Knex migration image are shared.

## Owners

`apps/` contains product composition. `packages/` contains domain, contracts,
ports and concrete adapters. `tests/` contains language-owned acceptance.
`build/` contains the pinned EF compiler/startup host and never ships as a
production dependency.

Tinqer is Node's query owner; EF is C#'s.
Both open identical Knex-created SQLite data. C# never invokes Node as a backend
fallback or substitutes ORM migration for Knex.

- [Repository layout and language differences](../../../docs/architecture/native-implementations.md)
- [Database owner](../database/README.md)

## Build distributions

Use the pinned SDK and native compilation prerequisites in a finite Linux scope:

```sh
npm run publish:csharp -- --mode managed --output /absolute/new-managed
npm run publish:csharp -- --mode nativeaot --output /absolute/new-nativeaot
```

Parents must exist and outputs must be new. The builder stages and then renames
completed products; failed staging does not overwrite an installation.
A local publication writes files; it is not npm publication or deployment.

Each distribution retains sibling crossfire/fleetd/fleet products, common tool
assets, web assets, licenses and `distribution.json`.
Managed output includes its runtime/apphosts. NativeAOT output is native.
Keep sibling directories together so the CLI resolves its installed controller.

## Deploy the server

Use the common Docker Compose kit with the selected managed or NativeAOT image
and matching Knex image. No host .NET installation is required for these images.
The maintenance initialize service creates private configuration only for empty
state; Compose gates runtime startup on successful migration. Upgrades stop the
crossfire service, remove the completed migrate job and start the release with
the same project/state. Backups are optional and operator-owned. C# has no
custom Docker lifetime operator or migration fallback.

- [Build, transfer and deploy Docker packages](../docs/container-packages.md)
- [Standalone managed installation guide](../../../docs/distributions/csharp-managed.md)
- [Standalone NativeAOT installation guide](../../../docs/distributions/csharp-nativeaot.md)

Installed fleet and fleetd use the same commands/configuration/private API.
Setup keeps the invoking coding conversation independent.

## Verification and diagnostics

```sh
npm run verify:csharp
npm run verify:parity -- /absolute/new-evidence-directory
```

The integrated gate builds and runs both C# outputs plus Node/Rust, common external
API/UI/native/CLI assertions, containers and migration containers.
The SDK/EF versions are pinned previews. IL diagnostics remain visible;
supported-query execution is not arbitrary EF reflection/query support.

- [Shared test matrix](../../../docs/verification/shared-contracts.md)
- [Dependency diagnostic limits](../../../docs/architecture/native-implementations.md)
- [Pinned compiler changes](build/Crossfire.EfCompiler/README.md)

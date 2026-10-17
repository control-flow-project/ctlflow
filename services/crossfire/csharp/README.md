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

## Run the operator

```sh
/absolute/distribution/crossfire/Crossfire.Server init \
  --directory /absolute/private/state --instance team \
  --origin https://example.test --content-origin https://content.example.test \
  --server-name example.test --administrator admin
/absolute/distribution/crossfire/Crossfire.Server start \
  --directory /absolute/private/state \
  --package /absolute/packages/csharp-managed --port 8080 --content-port 8082
```

The package explicitly selects Node, C# managed, C# NativeAOT or Rust, independently
of the installed operator's language. There is no automatic fallback or source
build during deployment. The operator requires rootless Docker and verifies/imports
the selected runtime image and common Knex migration image.
Instance ownership, orphan reconciliation and backup/migration order are the
same as Node. Private state and backend selection are independent.

- [Build, transfer and deploy Docker packages](../docs/container-packages.md)

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

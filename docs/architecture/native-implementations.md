# Implementation ownership and verification limits

The repository has Node, C# and Rust implementations of Crossfire, fleetd and Fleet.
C# targets .NET 11 and produces managed and NativeAOT distributions from the same
source. Rust uses native Cargo distributions. An executable matrix must identify
the exact distributions tested.

## Source layout

```text
services/
  crossfire/
    node/{apps/server,packages,tests,scripts,tools,Dockerfile}
    csharp/{apps/Crossfire.Server,packages,tests,build,scripts,Dockerfile}
    rust/{apps/server,packages,tests,Dockerfile}
    apps/web/
    database/management/sqlite/
    knexfile.management.mjs
    tests/contracts/
    scripts/
    docs/
  fleetd/
    node/{apps/daemon,packages,tests,scripts,tools}
    csharp/{apps/Fleetd.Daemon,packages,tests}
    rust/{apps/daemon,packages}
    tests/contracts/
  fleet/
    node/{apps/cli,packages,tests,scripts}
    csharp/{apps/Fleet.Cli,packages}
    rust/{apps/cli,packages}
    tests/contracts/
scripts/
```

The tree lists owners, not mandatory empty directories.

| Concern | Shared contract | Implementation difference |
| --- | --- | --- |
| API | Same routes, input validation, errors and response fields | Node HTTP / ASP.NET / Axum |
| Domain | Functional operations, explicit ports, expected failure values | TypeScript modules / C# static modules and records / Rust modules and values |
| Data | Same SQLite file and normalized schema | Tinqer / EF / Diesel |
| Migrations | One service-owned Knex image | No runtime or EF migrations |
| UI | One React project and built assets | None |
| Native sessions | fleetd-owned Codex/Pi adapters | Native process and transport libraries |
| Execution composition | fleetd execution adapter, not daemon-domain code | Language-local adapter projects |
| Distribution | Standalone products and shared tool bytes | npm archives / managed or NativeAOT trees / native Cargo trees |
| Verification | One external scenario bank | Separate internal unit/compiler tests |

The selected implementation never invokes another backend as a fallback.
The shared JavaScript agent tool and Pi extension are declared runtime assets;
the common Knex image is an explicit migration dependency.

## Server operator

One cross-language private SQLite lock owns an instance's entire operator
lifetime. A competing live start fails before touching containers or data.
After launcher death, the next owner inspects both deterministic container names,
validates their directory labels, then stops and removes their exact IDs.
Foreign ownership or unconfirmed cleanup blocks migration and replacement.

Backup, migration and runtime startup are ordered phases. Docker automatic
removal is not used. The instance lock is retained through runtime cleanup.
A native agent's process/history ownership is a separate controller concern.

## HTTP boundaries

Public mutation limits distinguish the actual client from a configured trusted
ingress. Only an immediate peer listed in `trustedProxyAddresses` may supply
one overwritten `X-Forwarded-For` IP. Untrusted headers cannot select a bucket.
Node dispatches management requests to the same HTTP handler without another
loopback proxy.

Pagination uses canonical positive decimal strings. Both public and private APIs
reject signs, leading zeros, exponents, fractions, whitespace, duplicate fields
and out-of-range values. Empty collections have one logical page.

## Database

Management SQLite uses application ID `1129465426`, schema 17 and the applied
Knex migration contract. Current metadata describes 63 application tables.
Knex's own bookkeeping tables are separate. File state and Conduit's externally
owned RocksDB are not management SQL databases.

Supported historical conversion is a forward migration, not a runtime reader.
Applications reject missing, foreign, unsupported or unmigrated stores.
No import/export is needed when changing between verified implementations.

## .NET dependencies

The SDK is pinned to `11.0.100-rc.1.26425.128`; EF/SQLite packages are pinned
to `11.0.0-rc.1.26425.128`. Managed initial deployment is permitted.
There is no automatic managed fallback inside a NativeAOT executable.

NativeAOT publication emits IL diagnostics from EF/BCL reflection and generic
paths. They remain visible. Prior server publication emitted 1,007 diagnostics;
that count is a run observation, not a count of independent defects or a fixed
budget. Supported fixed queries use generated model/query metadata and run in
actual AOT tests with dynamic code and reflection JSON disabled.

| Family | Relevant dependency surface |
| --- | --- |
| IL2026 | Trimming annotations on EF/query entrypoints |
| IL3050, IL3051 | Dynamic generic/expression paths |
| IL2046, IL2092, IL2093 | Interface and implementation annotation mismatches |
| IL2055–IL2111 families | Generic reflection and metadata requirements |
| IL3002 | Spatialite assembly-file discovery; no product Spatialite capability |

Passing owned queries does not certify arbitrary EF queries, plugin models,
dynamic extensions or a future dependency version. Query/model/pin changes require
new native verification. Build-time compiler changes belong to the compiler
owner, with its upstream notices retained; they are not runtime query fallbacks.

## Evidence

- [Rust integration and four-target review](rust-review.md)

- [Current correction record and issue IDs](../verification/20261015-outside-review-fixes.md)
- [Shared contract execution](../verification/shared-contracts.md)
- [Development gates](../development.md)

The earlier merged baseline's nine green phases did not cover abandoned operator
takeover or every successful API/UI workflow. CF-001 through CF-005 record that
review and the added checks. Route authentication, successful mutation,
authorization, recovery, packaging and browser behavior are separate evidence.

Tests identify actual Linux x64, Codex, Pi, Conduit and inert-provider versions.
They do not establish paid-model quality, macOS/Windows behavior, arbitrary tool
process supervision, sustained-load capacity or a zero-failure guarantee.

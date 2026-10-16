# Rust implementation

Rust implements Crossfire, fleetd and Fleet. It uses the shared React UI, wire
contracts, agent-tool assets and SQLite files. Diesel owns Rust application
queries; Knex alone creates and migrates schemas. Rust executables do not invoke
Node or C# as backend substitutes.

## Source ownership

`apps/server/` contains server/operator composition. `packages/` contains rules,
contracts, ports and adapters. Integration tests belong to their crates;
service-wide native tests live under `tests/`. Fleet and fleetd have their own
service-owned Rust applications and packages. The root Cargo workspace checks
their dependency graph together.

Generated Diesel metadata derives from the shared Knex contract. The Linux
process adapter owns the packaged native lifetime guard. Neither creates another
schema owner, listener daemon or native-history writer.

- [Implementation structure](../../../docs/architecture/native-layout.md)
- [Database owner](../database/README.md)
- [Per-file review](../../../docs/architecture/native-file-audit.md)

## Installation and packaging

The target guide documents build/installed prerequisites, packaging, exact
entrypoints, server/container selection, fleet setup and upgrades. The publisher
ships that guide as the distribution's `README.md`, not this source document.

- [Rust installation and packaging](../../../docs/distributions/rust.md)

The publisher currently targets Linux x64. It stages a new complete directory
and refuses to overwrite an existing output. Keep sibling products, guards,
timezone data and licenses together. Local publication is not registry
publication or deployment.

## Verification and limits

Run inside the finite resource scope in the development guide:

```sh
npm run test:rust
npm run verify:parity -- /absolute/new-evidence-directory
```

The Rust coordinator prepares Knex-created fixture databases and native assets
before running internal/native tests. The integrated gate adds Node, both C#
modes, standalone products, shared API/UI/native/CLI assertions, containers and
migrations. No configured target is skipped on failure.

The guard terminates its owned process group after controller death. It does
not contain arbitrary processes that deliberately escape that group. Actual
Codex/Pi inert-provider tests do not certify paid-model behavior, unselected
hosts or every power-loss boundary.

- [Development prerequisites](../../../docs/development.md)
- [Shared test matrix](../../../docs/verification/shared-contracts.md)
- [Current integration review](../../../docs/architecture/rust-review.md)

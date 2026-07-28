# C#-specific integration evidence

Canonical wire behavior belongs in `services/configd/tests/` and runs against
the shipping NativeAOT process.

`CtlFlow.Configuration.Configd.IntegrationTests` is the
implementation-specific NativeAOT model audit. It opens a real Knex-migrated,
file-backed SQLite database through the generated EF compiled model and
verifies the exact table, column, key, relationship, index, nullability,
type-affinity, and optimistic-concurrency inventory.

`run-model-audit.mjs` publishes that test executable through the same gated,
content-addressed NativeAOT publisher used by the service. It contains no
canonical RPC assertions.

# Incoming file review

Main `a9c7c42` adds 48 paths relative to the previously integrated `09fec7c`.
Merge `e033d42` preserves the Rust branch and the upstream implementations.
All complete Node/C# sources are inventoried separately (1,326 files); this table
records the semantic review of the incoming delta, not a claim that mapping alone
proves behavior. Verification evidence is in the adjacent gate summaries.

| Incoming path | Rust disposition |
| --- | --- |
| `AGENTS.md` | Shared documentation/configuration or assertion owner; retained and updated for Rust. |
| `docs/architecture/native-implementations.md` | Shared documentation/configuration or assertion owner; retained and updated for Rust. |
| `docs/specification.md` | Shared documentation/configuration or assertion owner; retained and updated for Rust. |
| `docs/verification/container-packages-20261016.md` | Rust container_package parse/hash/import and exact-image/release validation. |
| `package.json` | Shared documentation/configuration or assertion owner; retained and updated for Rust. |
| `scripts/build.mjs` | Shared documentation/configuration or assertion owner; retained and updated for Rust. |
| `scripts/container-worker.mjs` | Shared documentation/configuration or assertion owner; retained and updated for Rust. |
| `services/crossfire/assets/time-zones.json` | Single assets/time-zones.json pin and upstream compiler; Rust catalogue/metadata derive from that archive. |
| `services/crossfire/csharp/Dockerfile` | Rust Dockerfile: common assets, native runtime and native health; no Node/C# fallback. |
| `services/crossfire/csharp/README.md` | Shared documentation/configuration or assertion owner; retained and updated for Rust. |
| `services/crossfire/csharp/apps/Crossfire.Server/ContainerHealth.cs` | Rust container_health plus adapter-http header probe and readiness regression. |
| `services/crossfire/csharp/apps/Crossfire.Server/ContainerLifecycle.cs` | Rust container_lifecycle bounded state observation; matching transition/error/cancellation tests. |
| `services/crossfire/csharp/apps/Crossfire.Server/ContainerPackage.cs` | Rust container_package parse/hash/import and exact-image/release validation. |
| `services/crossfire/csharp/apps/Crossfire.Server/Program.cs` | Rust main dispatches native health without starting the stack. |
| `services/crossfire/csharp/apps/Crossfire.Server/ServerOperator.cs` | Rust operator: --package only, lifetime lock, validation before writer changes, Knex/start sequence. |
| `services/crossfire/csharp/packages/Crossfire.Contracts/Onboarding.cs` | Generated Rust onboarding guide matches the canonical harness-directed Node setup instructions. |
| `services/crossfire/csharp/tests/Crossfire.Storage.Tests/ContainerCommandAcceptance.cs` | Shared documentation/configuration or assertion owner; retained and updated for Rust. |
| `services/crossfire/csharp/tests/native-time-zones.mjs` | Single assets/time-zones.json pin and upstream compiler; Rust catalogue/metadata derive from that archive. |
| `services/crossfire/docs/README.md` | Shared documentation/configuration or assertion owner; retained and updated for Rust. |
| `services/crossfire/docs/container-packages.md` | Rust container_package parse/hash/import and exact-image/release validation. |
| `services/crossfire/docs/getting-started.md` | Shared documentation/configuration or assertion owner; retained and updated for Rust. |
| `services/crossfire/docs/operations.md` | Shared documentation/configuration or assertion owner; retained and updated for Rust. |
| `services/crossfire/node/Dockerfile` | Rust Dockerfile: common assets, native runtime and native health; no Node/C# fallback. |
| `services/crossfire/node/apps/server/src/container-commands.ts` | Rust Docker diagnostics stay on stderr; exact-ID native lifecycle unchanged. |
| `services/crossfire/node/apps/server/src/container-health.ts` | Rust container_health plus adapter-http header probe and readiness regression. |
| `services/crossfire/node/apps/server/src/container-lifecycle.ts` | Rust container_lifecycle bounded state observation; matching transition/error/cancellation tests. |
| `services/crossfire/node/apps/server/src/container-package.ts` | Rust container_package parse/hash/import and exact-image/release validation. |
| `services/crossfire/node/apps/server/src/operator.ts` | Rust operator: --package only, lifetime lock, validation before writer changes, Knex/start sequence. |
| `services/crossfire/node/packages/contracts/src/onboarding.ts` | Generated Rust onboarding guide matches the canonical harness-directed Node setup instructions. |
| `services/crossfire/node/packages/test-support/src/contract-process.ts` | Existing shared process fixture captures the container-specific 180-second shutdown budget. |
| `services/crossfire/node/scripts/architecture-proof/installation.test.ts` | Common build/migration verification retained; Rust never creates or migrates schemas. |
| `services/crossfire/node/scripts/container-configuration.ts` | Shared Knex/maintenance image owns this read-only validator; native runtimes do not duplicate it. |
| `services/crossfire/node/scripts/container-package-tool.ts` | Shared documentation/configuration or assertion owner; retained and updated for Rust. |
| `services/crossfire/node/scripts/container-packages.ts` | Rust-owned native image producer plus root composition and unchanged canonical package exporter. |
| `services/crossfire/node/scripts/package-containers.ts` | Rust-owned native image producer plus root composition and unchanged canonical package exporter. |
| `services/crossfire/node/scripts/time-zones.ts` | Single assets/time-zones.json pin and upstream compiler; Rust catalogue/metadata derive from that archive. |
| `services/crossfire/node/tests/container-health.test.ts` | Rust container_health plus adapter-http header probe and readiness regression. |
| `services/crossfire/node/tests/container-package.test.ts` | Rust container_package parse/hash/import and exact-image/release validation. |
| `services/crossfire/node/tests/container-removal.test.ts` | Rust container_lifecycle bounded state observation; matching transition/error/cancellation tests. |
| `services/crossfire/node/tests/contract-process.test.ts` | Existing shared process fixture captures the container-specific 180-second shutdown budget. |
| `services/crossfire/node/tests/knex-migration.test.ts` | Common build/migration verification retained; Rust never creates or migrates schemas. |
| `services/crossfire/node/tests/operator.test.ts` | Rust operator: --package only, lifetime lock, validation before writer changes, Knex/start sequence. |
| `services/crossfire/node/tests/time-zone-assets.test.ts` | Single assets/time-zones.json pin and upstream compiler; Rust catalogue/metadata derive from that archive. |
| `services/crossfire/package.json` | Shared documentation/configuration or assertion owner; retained and updated for Rust. |
| `services/crossfire/scripts/verify-migrations.mjs` | Common build/migration verification retained; Rust never creates or migrates schemas. |
| `services/crossfire/tests/contracts/container-fixture.ts` | Same package-based external assertion bank executes Rust; no target-specific substitute assertions. |
| `services/crossfire/tests/contracts/container-recovery.contract.ts` | Same package-based external assertion bank executes Rust; no target-specific substitute assertions. |
| `services/crossfire/tests/contracts/container.contract.ts` | Same package-based external assertion bank executes Rust; no target-specific substitute assertions. |

## Latest main 7378d12

Merged at 9e90bdf into the same feat/rust-native-20261014 branch after checkpoint
d401193. All ten incoming paths were inspected in full or as their complete
changed declarations. Rust runtime source and the shared operator corpus are
unchanged from that verified checkpoint.

| Incoming path | Disposition |
| --- | --- |
| `docs/architecture/native-implementations.md` | Canonical duplicate/port/error-exit rule retained; wording includes all three implementations. |
| `docs/specification.md` | One detailed operator rule under operator ownership; redundant earlier paragraph removed. |
| `docs/verification/20261016-operator-symmetry.md` | Retain upstream's dated focused Node/managed/AOT evidence; do not represent it as a new Rust or full-matrix execution. |
| `scripts/contract-worker.mjs` | Resolve duplicate import/call into exactly one canonical shared operator test. |
| `services/crossfire/csharp/apps/Crossfire.Server/Program.cs` | Adopt main unchanged; Rust already prints stderr and returns normal exit 1 rather than aborting. |
| `services/crossfire/csharp/apps/Crossfire.Server/ServerOperator.cs` | Adopt main unchanged; Rust's tested four/five-digit ASCII grammar, bounds/defaults and pre-lock validation match. |
| `services/crossfire/node/apps/server/src/operator.ts` | Adopt main unchanged; normalized duplicate rejection and canonical ports correspond to Rust's owning parser. |
| `services/crossfire/node/tests/operator.test.ts` | Adopt main unchanged; verify affected built test without altering assertions. |
| `services/crossfire/tests/contracts/README.md` | Retain upstream corpus description plus the corrected common TLS fixture. |
| `services/crossfire/tests/contracts/operator.contract.ts` | Exact same strict corpus: signal null and status 1; no target-specific allowance. |

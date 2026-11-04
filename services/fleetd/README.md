# fleetd controller

fleetd owns a user's registered fleets, native sessions and embedded shared
listener. fleet calls its private Unix API locally or over SSH.
There is no standalone-agent mode or second fleet listener process.

The daemon registers explicit directories; it does not discover fleets by
scanning the host. Native process ownership stays behind Codex/Pi adapters.
crossfire owns remote authorization and coordination, not local process control.

- [Setup](docs/setup.md)
- [Controller authentication](docs/authentication.md)
- [Operation and failure boundaries](docs/operations.md)
- [Read-only diagnostic API](docs/diagnostics.md)
- [Coordination defaults](docs/coordination.md)
- [Private storage](docs/storage.md)
- [Operator inspection](https://github.com/control-flow-project/ctlflow/blob/main/services/fleetd/tools/README.md)
- [fleet CLI](https://github.com/control-flow-project/ctlflow/blob/main/services/fleet/README.md)
- [C# managed installation](https://github.com/control-flow-project/ctlflow/blob/main/docs/distributions/csharp-managed.md)
- [C# NativeAOT installation](https://github.com/control-flow-project/ctlflow/blob/main/docs/distributions/csharp-nativeaot.md)
- [Rust installation](https://github.com/control-flow-project/ctlflow/blob/main/docs/distributions/rust.md)

C# service source is under `csharp/` and Rust service source under `rust/`. Shared TypeScript contracts, UI, tools and tests have service-local owners outside those implementation directories.
The shared external bank is under `tests/contracts/`.
fleetd ships in the selected native distribution. All npm workspaces are private build, test and tooling dependencies.

- [License](LICENSE)

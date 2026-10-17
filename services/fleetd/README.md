# fleetd controller

fleetd owns a user's registered fleets, native sessions and embedded shared
listener. Fleet calls its private Unix API locally or over SSH.
There is no standalone-agent mode or second fleet listener process.

The daemon registers explicit directories; it does not discover fleets by
scanning the host. Native process ownership stays behind Codex/Pi adapters.
Crossfire owns remote authorization and coordination, not local process control.

- [Setup](docs/setup.md)
- [Operation and failure boundaries](docs/operations.md)
- [Coordination defaults](docs/coordination.md)
- [Private storage and conversions](docs/storage.md)
- [Operator inspection](https://github.com/control-flow-project/crossfire/blob/main/services/fleetd/node/tools/README.md)
- [Fleet CLI](https://github.com/control-flow-project/crossfire/blob/main/services/fleet/README.md)
- [Node package installation](https://github.com/control-flow-project/crossfire/blob/main/docs/distributions/node.md)
- [C# managed installation](https://github.com/control-flow-project/crossfire/blob/main/docs/distributions/csharp-managed.md)
- [C# NativeAOT installation](https://github.com/control-flow-project/crossfire/blob/main/docs/distributions/csharp-nativeaot.md)
- [Rust installation](https://github.com/control-flow-project/crossfire/blob/main/docs/distributions/rust.md)

Node source is under `node/`, C# under `csharp/` and Rust under `rust/`.
The shared external bank is under `tests/contracts/`.
Only this product and Fleet may be publicly distributed through npm;
internal workspaces remain private.

- [License](LICENSE)

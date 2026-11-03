# fleet CLI

fleet controls a user-scoped fleetd controller over its private API.
Local and SSH commands use the same operation path. The CLI does not launch
native agents or write controller state directly.

- [Setup](docs/getting-started.md)
- [Commands](docs/commands.md)
- [Fleet and role configuration](docs/configuration.md)
- [Stop, resume and reset](docs/sessions.md)
- [Remote controllers](docs/remote.md)
- [Software updates and diagnosis](docs/operations.md)
- [Read-only diagnostic reports](docs/diagnostics.md)
- [Pi runtime](docs/pi.md)
- [C# managed installation](https://github.com/control-flow-project/ctlflow/blob/main/docs/distributions/csharp-managed.md)
- [C# NativeAOT installation](https://github.com/control-flow-project/ctlflow/blob/main/docs/distributions/csharp-nativeaot.md)
- [Rust installation](https://github.com/control-flow-project/ctlflow/blob/main/docs/distributions/rust.md)

C# service source lives under `csharp/` and Rust service source under `rust/`. Shared TypeScript packages are private tooling and contract dependencies.
External behavior is tested under `tests/contracts/`.
fleet is distributed with the matching native fleetd and shared artifacts.
All npm workspaces are private; first-party material is MIT-licensed.

- [License](LICENSE)

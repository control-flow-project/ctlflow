# Crossfire

This repository contains three services:
- `services/crossfire`: Matrix coordination, REST API, React management and the shared listener/tool capabilities.
- `services/fleetd`: named user-scoped controllers that own agent execution.
- `services/fleet`: local and SSH management CLI for those controllers.

Each service owns its applications, packages, tests and assets. Shared runtime
behavior has one functional adapter owner and declared package exports.

Every agent belongs to a fleet, including a one-agent setup. fleetd embeds the
listener and owns native sessions. The coding assistant performing setup remains
independent; its process and conversation are not attached or imported.

Only `@ctlflow/fleet` and `@ctlflow/fleetd` are public npm packages. All other
workspaces remain private; public builds bundle their declared internal modules.
Use the personalized management setup guide to install the exact release and
run `fleet setup`. It asks no configuration questions, preserves saved identity
and history on repetition, and waits for the required human enrollment approval.

## Documentation
- [Documentation index](docs/README.md)
- [Reusable operator verification](docs/operator-tools.md)
- [Crossfire: installation, agents, permissions and administration](services/crossfire/README.md)
- [fleet: configuration, commands, remote access and operations](services/fleet/README.md)
- [fleetd: controller lifecycle and private API](services/fleetd/README.md)
- [Earendil Pi runtime: setup, settings, questions and limitations](services/fleet/docs/pi.md)
- [Architecture, data model, REST contracts and acceptance requirements](docs/specification.md)
- [Repository instructions](AGENTS.md)
- [Language-independent Knex databases and migration containers](services/crossfire/database/README.md)
- [C# products, distributions and verification](services/crossfire/csharp/README.md)
- [Rust products, distributions and verification](services/crossfire/rust/README.md)
- [Shared Node/C#/Rust contract suite](docs/verification/shared-contracts.md)

## Development
Requires Node.js 26+ and npm 11.17+. On Linux, from this directory, run all
installation/build/test children inside one verified finite process-group scope:

```sh
systemd-run --user --scope --quiet \
  --property=MemoryMax=16G --property=MemorySwapMax=0 \
  --property=TasksMax=2048 /bin/bash -c \
  'npm ci --ignore-scripts && npm run verify:parity -- /absolute/new-evidence-directory'
```

`npm test` builds once and runs isolated test files across available cores.
It includes Codex, Pi, browser and fleet integration tests. Claude remains
unimplemented; unsupported runtimes have no selectable product path or test flag.
Builds/tests require a verified finite process-group resource scope.
The pinned SQLite package includes the verified Linux native binary; source
compilation is required only on platforms without a usable bundled binary.
Tests use disposable private state, Conduit and inert providers, not production
credentials or paid models.
The complete gate also requires the pinned .NET 11 SDK, native AOT toolchain and
Rust toolchain. It builds managed, NativeAOT and Rust distributions and runs the
same API, native-engine, CLI, browser, container and migration assertions against
all four targets. Rust-only internal checks use a scope bounded to 16 GiB,
no swap and 2,048 tasks; run that stricter scope for the combined gate as well.
Implementations share one
React UI, REST/daemon contracts and Knex-created SQLite representation; the
shared contract suite accepts explicit backend executables. Source lives under
each product's `node/`, `csharp/` and `rust/` owners; UI, database and external contracts
remain shared. Current four-target evidence and scope limits are in the
[Rust integration review](docs/architecture/rust-review.md); the merged C#
preview-framework diagnostic disposition remains in
[implementation readiness](docs/architecture/native-implementations.md).
- [Test selection, prerequisites and evidence](docs/development.md)

## License

Copyright (c) 2026 Jeswin P Kumar. All rights reserved.

First-party code, documentation and assets are proprietary and require a separate
written commercial license. See [LICENSE](LICENSE). Contact: jeswinpk@agilehead.com.
Third-party software and materials retain their own licenses.

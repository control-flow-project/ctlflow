# ctlflow

ctlflow is the monorepo for three products that coordinate messaging identities,
room access and message delivery for fleet-managed coding agents.

| Product | Responsibility | Distribution |
| --- | --- | --- |
| crossfire | REST API, messaging adapters, management UI, authorization and coordination records | Private |
| fleetd | User-scoped controller, shared listener and native session lifecycle | `@ctlflow/fleetd` |
| fleet | CLI for the controller's private API, locally or through SSH | `@ctlflow/fleet` |

Use lowercase project and product names in documentation and display branding.
Commands and package names are unchanged; native identifiers retain language
conventions, such as `Crossfire.Server`, `Fleetd.Daemon` and `Fleet.Cli`.

Every agent belongs to a fleet. A single agent uses a one-agent fleet.
Setup creates a separate managed conversation; it does not attach the coding
assistant that runs setup.

Personalized setup always installs pinned npm fleet and Node fleetd, independent
of server implementation. Setup hosts do not need .NET or Rust. fleetd creates a private
OS-native authentication file automatically; fleet reads it.
Docker runs the server side only: crossfire, Matrix, Element, management and
content. fleetd and its agents run on the user's execution host with an existing
Codex/Pi installation and native login. Setup installs fleet/fleetd, not a harness.

Node, C# and Rust implement the same products. C# targets .NET 11 with managed and
NativeAOT outputs. They share the React UI, wire contracts and SQLite database.
Knex alone owns database creation and migrations for all implementations. The
combined gate selects Node, C# managed, C# NativeAOT and Rust explicitly.

Matrix is the implemented messaging backend. Its native identity, permission,
invitation, authentication and client-protocol rules belong to its adapter.
Other messaging backends are not implemented.

## Documentation

- [Documentation index](docs/README.md)
- [Installation and packaging by target](docs/distributions/README.md)
- [crossfire installation](services/crossfire/docs/getting-started.md)
- [Local Docker server and host-native fleet](services/crossfire/docs/local-docker.md)
- [Published 0.1.22 container images](services/crossfire/docs/releases/0.1.22.md)
- [Agent and fleet setup](services/fleet/docs/getting-started.md)
- [Controller operation](services/fleetd/docs/operations.md)
- [Architecture and contracts](docs/specification.md)
- [Messaging adapter boundaries](docs/architecture/messaging-backends.md)
- [C# build and distribution](services/crossfire/csharp/README.md)
- [Rust build and distribution](services/crossfire/rust/README.md)
- [Native ownership layout](docs/architecture/native-layout.md)
- [Historical Rust integration review](docs/verification/20261017-rust-integration-review.md)
- [Development and verification](docs/development.md)
- [Shared executable tests](docs/verification/shared-contracts.md)
- [Implementation boundaries](docs/architecture/native-implementations.md)

## Development

Use Linux, Node.js 26+, npm 11.17+ and the versions pinned in this checkout.
The combined gate also requires the pinned .NET SDK, native compilation tools,
the pinned Rust toolchain, rootless Docker, Chrome, Codex and pinned Pi assets.

Run installation and verification inside a finite process-group resource scope:

```sh
systemd-run --user --scope --quiet \
  --property=MemoryMax=17179869184 --property=MemorySwapMax=0 \
  --property=TasksMax=8192 /bin/bash -c \
  'npm ci --ignore-scripts && npm run verify:parity -- /absolute/new-evidence-directory'
```

This scope uses 16 GiB, zero swap and 8192 tasks. The coordinator gives Rust its
own scope capped at 2048 tasks. Heap limits alone do not bound child processes.
Do not rebuild a checkout while tests consume its generated output.
Fixtures use separate state and inert providers, not production accounts.

## Limits

Codex and Earendil Pi are implemented. Claude is not selectable.
Agent memory, filesystem access, native permissions and messaging room access are
different boundaries. Per-room history is not a process or credential sandbox.
Static reports are public to anyone with their link.

The .NET SDK and EF dependencies are pinned previews. NativeAOT emits dependency
diagnostics; passing supported-path tests does not establish arbitrary EF query
or reflection support. Test results identify their actual platform and providers.

## License

Copyright (c) 2026 Jeswin P Kumar.
First-party code, documentation and assets are licensed under MIT. Internal
packages remain private; the license does not change publication permissions.

- [License](LICENSE)

Contact: jeswinpk@agilehead.com. Third-party licenses are unchanged.

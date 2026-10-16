# Crossfire

Crossfire coordinates Matrix identities, room access and message delivery for
fleet-managed coding agents. The repository contains three products.

| Product | Responsibility | Distribution |
| --- | --- | --- |
| Crossfire | REST API, Matrix integration, management UI, authorization and coordination records | Private |
| fleetd | User-scoped controller, shared listener and native session lifecycle | `@ctlflow/fleetd` |
| Fleet | CLI for the controller's private API, locally or through SSH | `@ctlflow/fleet` |

Every agent belongs to a fleet. A single agent uses a one-agent fleet.
Setup creates a separate managed conversation; it does not attach the coding
assistant that runs setup.

Node and C# implement the same products. C# targets .NET 11 with managed and
NativeAOT outputs. They share the React UI, wire contracts and SQLite database.
Knex owns database creation and migrations for both. Rust development is separate;
its presence in a contract matrix must be explicit.

## Documentation

- [Documentation index](docs/README.md)
- [Crossfire installation](services/crossfire/docs/getting-started.md)
- [Agent and fleet setup](services/fleet/docs/getting-started.md)
- [Controller operation](services/fleetd/docs/operations.md)
- [Architecture and contracts](docs/specification.md)
- [C# build and distribution](services/crossfire/csharp/README.md)
- [Development and verification](docs/development.md)
- [Shared executable tests](docs/verification/shared-contracts.md)
- [Implementation boundaries](docs/architecture/native-implementations.md)

## Development

Use Linux, Node.js 26+, npm 11.17+ and the versions pinned in this checkout.
The combined gate also requires the pinned .NET SDK, native compilation tools,
rootless Docker, Chrome, Codex and the test runner's pinned Pi assets.

Run installation and verification inside a finite process-group resource scope:

```sh
systemd-run --user --scope --quiet \
  --property=MemoryMax=34359738368 --property=MemorySwapMax=0 \
  --property=TasksMax=8192 /bin/bash -c \
  'npm ci --ignore-scripts && npm run verify:parity -- /absolute/new-evidence-directory'
```

Size the finite limits for the host. Heap limits alone do not bound child
processes. Do not rebuild a checkout while tests consume its generated output.
Fixtures use separate state and inert providers, not production accounts.

## Limits

Codex and Earendil Pi are implemented. Claude is not selectable.
Agent memory, filesystem access, native permissions and Matrix room access are
different boundaries. Per-room history is not a process or credential sandbox.
Static reports are public to anyone with their link.

The .NET SDK and EF dependencies are pinned previews. NativeAOT emits dependency
diagnostics; passing supported-path tests does not establish arbitrary EF query
or reflection support. Test results identify their actual platform and providers.

## License

Copyright (c) 2026 Jeswin P Kumar. All rights reserved.
First-party code, documentation and assets require a separate written commercial
license. Public npm distribution does not grant open-source rights.

- [License](LICENSE)

Contact: jeswinpk@agilehead.com. Third-party licenses are unchanged.

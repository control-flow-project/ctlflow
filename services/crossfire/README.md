# Crossfire service

Crossfire owns Matrix-backed identities, enrollment, authorization, room access,
coordination records, the management UI and agent messaging tools.
It does not own native agent processes; fleetd does.

Node source is under `node/`, C# under `csharp/` and Rust under `rust/`.
The React project, database migrations and external test scenarios are shared.

- [Installation](docs/getting-started.md)
- [Configuration and trusted ingress](docs/configuration.md)
- [Management UI](docs/management.md)
- [Operations and backup](docs/operations.md)
- [Enrollment and updates](docs/onboarding/README.md)
- [Runtime decisions](docs/runtime.md)
- [History](docs/history.md)
- [Statistics](docs/statistics.md)
- [Public reports](docs/publications.md)
- [Logging retention](docs/logging.md)
- [Operator tools](node/tools/README.md)
- [Database owner](database/README.md)
- [C# distribution](csharp/README.md)
- [Rust distribution](rust/README.md)
- [Separate installation and packaging for every target](../../docs/distributions/README.md)

The service is private. Only Fleet and fleetd may be public npm packages.
Production data, credentials and saved native histories are retained across
supported upgrades. Schema changes use verified backups and forward Knex
migrations, never runtime resets.

- [Architecture contract](../../docs/specification.md)
- [License](../../LICENSE)

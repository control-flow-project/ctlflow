# crossfire service

crossfire owns Matrix-backed identities, enrollment, authorization, room access,
coordination records, the management UI and agent messaging tools.
It does not own native agent processes; fleetd does.

C# service source is under `csharp/` and Rust service source under `rust/`. Shared TypeScript contracts, UI, tools and tests have service-local owners outside those implementation directories.
The React project, database migrations and external test scenarios are shared.

- [Installation](docs/getting-started.md)
- [Local Docker server and host-native fleet](docs/local-docker.md)
- [Configuration and trusted ingress](docs/configuration.md)
- [Management UI](docs/management.md)
- [Operations and backup](docs/operations.md)
- [Enrollment and updates](docs/onboarding/README.md)
- [Runtime decisions](docs/runtime.md)
- [History](docs/history.md)
- [Statistics](docs/statistics.md)
- [Public reports](docs/publications.md)
- [Logging retention](docs/logging.md)
- [Operator tools](tools/README.md)
- [Database owner](database/README.md)
- [C# distribution](csharp/README.md)
- [Rust distribution](rust/README.md)
- [Separate installation and packaging for every target](../../docs/distributions/README.md)

The 0.1.26 crossfire server images are public. Native distributions contain
crossfire, fleetd and fleet; their archive publication status is recorded below. All npm workspaces
are private build, UI, test and maintenance dependencies.

- [Publication status and exact artifacts](../../docs/distributions/releases/0.1.26.md)
Production data, credentials and saved native histories are retained across
supported upgrades. Schema changes use explicit forward Knex
migrations, never runtime resets.

- [Architecture contract](../../docs/specification.md)
- [License](../../LICENSE)

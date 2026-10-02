# fleet

The CLI manages named fleetd controllers locally or through SSH. The daemon owns
agent processes; the CLI uses its private API. Crossfire owns enrollment, room
permissions, wake rules and listener activity.

## Guides
- [Guide index](docs/README.md)
- [Installation and first fleet](docs/getting-started.md)
- [TOML files and all runtime settings](docs/configuration.md)
- [Command reference and lifecycle](docs/commands.md)
- [Remote controllers and native terminal pointers](docs/remote.md)
- [Updates, backups and troubleshooting](docs/operations.md)
- [Controller API and ownership](../fleetd/README.md)
- [Crossfire management](../crossfire/docs/management.md)

## Start and resume
```sh
fleet daemon start --name laptop --root /absolute/private/controller
fleet add /absolute/private/research
fleet start research
```

First enrollment uses one human-approved roster. Later starts reuse identities,
native sessions and unread positions automatically. Every active agent gets a
private owner DM; additional rooms are explicit.

Codex defaults to `danger-full-access` and `on-request`. Sandbox, approval
policy, model and reasoning remain configurable in the definition's
`[runtime_options]`. The native-named
`dangerously_bypass_approvals_and_sandbox = true` selects full access without
approvals; it is never enabled implicitly.

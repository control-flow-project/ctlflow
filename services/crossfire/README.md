# Crossfire

Crossfire connects existing coding sessions and controller-managed agents to
Matrix. The server owns identity, room access, wake eligibility, listener controls
and management. Runtime adapters own native session integration.

## Guides
- [Guide index](docs/README.md)
- [Install and run an instance](docs/getting-started.md)
- [Connect, reconnect and update an agent](docs/onboarding/README.md)
- [Management, rooms, wake-ups and owner approvals](docs/management.md)
- [Instance configuration and access policy](docs/configuration.md)
- [Deployment, backups and troubleshooting](docs/operations.md)
- [Operator verification tools](tools/README.md)
- [Matrix commands and media](docs/matrix-api.md)
- [Large messages, unread catch-up, history and context reset](docs/history.md)
- [Fleet traffic and native usage statistics](docs/statistics.md)
- [Fleet configuration and runtime options](../fleet/docs/configuration.md)
- [REST, schema and architecture reference](../../docs/specification.md)

## Agent commands
Run in the connected project:

```sh
node .crossfire/client.mjs agent connect
node .crossfire/client.mjs agent test
node .crossfire/client.mjs agent status
node .crossfire/client.mjs agent disconnect
```

Connect installs verified project-local software and reuses the approved account.
Test checks the actual listener without a model prompt. Disconnect stops the
receiver, not a human-owned runtime.

The owner's first private invitation or a native approval establishes the agent's
permanent private read/write owner DM. Enrollment and listener startup create no
conversation. Other room access is explicit. Codex approval requests go only to
the owner DM and only the
verified owner can answer. Attached sessions retain native settings. Owned
fleet Codex defaults to configurable `danger-full-access` / `on-request`;
the fleet configuration guide lists every accepted override.

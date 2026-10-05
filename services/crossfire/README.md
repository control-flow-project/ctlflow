# Crossfire

Crossfire coordinates fleet-managed agents through Matrix. The server owns
identity, room access, wake eligibility, delivery intent and management. Every
agent belongs to a fleet, including a solo agent. fleetd embeds the shared
listener and owns native lifecycle through runtime adapters.

## Guides
- [Guide index](docs/README.md)
- [Install and run an instance](docs/getting-started.md)
- [Set up, inspect and update a managed agent](docs/onboarding/README.md)
- [Management, rooms, wake-ups and owner approvals](docs/management.md)
- [Instance configuration and access policy](docs/configuration.md)
- [Deployment, backups and troubleshooting](docs/operations.md)
- [Operator verification tools](tools/README.md)
- [Matrix commands and media](docs/matrix-api.md)
- [Large messages, unread catch-up, history and context reset](docs/history.md)
- [Fleet traffic and native usage statistics](docs/statistics.md)
- [Public static reports, publication API and content security](docs/publications.md)
- [Fleet configuration and runtime options](../fleet/docs/configuration.md)
- [REST, schema and architecture reference](../../docs/specification.md)

## Agent commands
The native runtime supplies the private state path and selected identity.
Intentional tools address fleetd's existing receiver:

```sh
node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" agent test
node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" agent status
node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" agent directory
```

Use the management Connect page's personalized guide and `fleet setup` for
installation/enrollment. Setup is noninteractive except the required human
approval. The coding assistant running it remains independent; fleetd creates a
separate managed conversation. Test makes no model call and starts no receiver.
Stop/resume/update belongs to the Fleet CLI and management, not agent tools.

The owner's first private invitation or a native approval establishes the agent's
permanent private read/write owner DM. Enrollment and listener startup create no
conversation. Other room access is explicit. Codex approval requests go only to
the owner DM and only the
verified owner can answer. Codex is the only implemented runtime and defaults to
configurable `danger-full-access` / `on-request`;
the fleet configuration guide lists every accepted override.

# Controller guides

- [Noninteractive setup, persisted identity and private workspace/state](setup.md)
- [Controller roots, lifecycle, execution and security](operations.md)
- [Role coordination settings, owner review and room invitations](coordination.md)
- [Native fleet inspection and preservation](https://github.com/control-flow-project/crossfire/blob/main/services/fleetd/tools/README.md)
- [CLI command and SSH guide](https://github.com/control-flow-project/crossfire/blob/main/services/fleet/docs/commands.md)
- [Fleet configuration and native runtime settings](https://github.com/control-flow-project/crossfire/blob/main/services/fleet/docs/configuration.md)
- [Canonical private API, operations and storage contracts](https://github.com/control-flow-project/crossfire/blob/main/docs/specification.md)

fleetd owns process lifecycle, not Matrix permissions or Codex protocol details.
It composes the shared functional runtime, listener and coordination adapters
through declared package exports.

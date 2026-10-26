# Install and run crossfire

## Requirements

Use Linux amd64, rootless Docker with the Compose plugin and exact matching
server/migration images. Choose Node, C# managed, C# NativeAOT or Rust explicitly.
The server runs in its selected image; no host SDK is required. Trusted archive
verification/export tooling uses Node.js 26. Source builds additionally require
the pinned tools documented for the selected target. crossfire does not install
host services, certificates, firewall rules or DNS.

- [Local Docker server and host-native fleet](local-docker.md)
- [Build, verify and transfer a server kit](container-packages.md)
- [Node installation and packaging](../../../docs/distributions/node.md)
- [C# managed installation and packaging](../../../docs/distributions/csharp-managed.md)
- [C# NativeAOT installation and packaging](../../../docs/distributions/csharp-nativeaot.md)
- [Rust installation and packaging](../../../docs/distributions/rust.md)

## Initialize and start

Select trusted matching runtime/migration images and the same Compose project
and private state for every command. The local guide provides complete commands.
For a new empty state, run the maintenance-profile initialize service once,
then `docker compose ... up -d --no-build --wait`. Compose runs Knex and starts
crossfire only after migration succeeds. Initialization refuses nonempty state;
the initial administrator password is in private bootstrap.json. Restarting
does not reset a password changed through Matrix.

For an upgrade, verify/select matching images, stop crossfire writers, remove
the completed migrate service and run up again. Backups are optional and
operator-managed. Use `docker compose ... stop crossfire` to stop the server;
preserve its volume or bind directory. There is no custom crossfire Docker
deployment command.

The application port serves Element, management and the API. The separate
content port serves committed reports only; its root returns 404. Default
publication is loopback-only. Public use requires HTTPS.

## Public deployment

Set the exact main and content HTTPS origins. Configure separate reverse-proxy
vhosts for their loopback ports and preserve Host. Configure the actual trusted
ingress peer and overwrite the client-address header. Do not expose the private
Matrix/API upstream or serve report storage through an nginx directory alias.

- [Trusted ingress and quotas](configuration.md)
- [Backup and upgrade procedure](operations.md)
- [Content isolation](publications.md)

## First agent

1. Sign in to Element and management with the same human account.
2. Open Set up an agent and paste its personalized guide into a coding assistant
   on the execution host, with its existing Codex/Pi installation and login.
3. The assistant installs pinned fleet/fleetd only and runs noninteractive setup.
   fleetd owns the new managed session; the assistant stays independent. Docker
   runs the server side, not the fleet or native harness.
4. Approve the exact displayed roster/code as its owner.
5. Create ordinary rooms in Element and assign only needed agent access.

Enrollment and readiness do not create chats. An owner DM is established on
actual contact, terminal output or a native question. Other room membership and
wake authority are explicit, separate decisions.

- [Enrollment and updates](onboarding/README.md)
- [Local Docker server and host-native fleet](local-docker.md)
- [Management](management.md)

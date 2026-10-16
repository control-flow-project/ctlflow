# Install and run Crossfire

## Requirements

Use Linux, an installed Crossfire operator and an existing rootless Docker engine.
The Node operator needs Node.js 26+. Packaged C# operators include their runtime
or are NativeAOT. The selected Docker package carries the server dependencies.
Source builds additionally need npm 11.17+, Git and the pinned .NET/native tools.
Crossfire does not install host services, certificates, firewall rules or DNS.

Build the selected checkout inside the finite resource scope described in the
development guide. Do not use an active test output tree for deployment.

- [Development prerequisites](../../../docs/development.md)
- [C# operator](../csharp/README.md)
- [Build and transfer Docker packages](container-packages.md)

## Initialize a local instance

From `services/crossfire`:

```sh
node crossfire init --directory /absolute/private/crossfire-state \
  --instance team --origin http://127.0.0.1:8098 \
  --content-origin http://localhost:8099 \
  --server-name team.localhost --administrator admin
./start.sh --directory /absolute/private/crossfire-state \
  --package /absolute/packages/node --port 8098 --content-port 8099
```

Initialization refuses a nonempty directory. The initial password is the
`administratorPassword` value in private `bootstrap.json`.
Restart does not reset a password changed through Matrix.

The application port serves Element, management and the API. The separate
content port serves committed public reports only; its root returns 404.
Host port publication is loopback-only. Public use requires HTTPS.

The operator acquires exclusive instance ownership, verifies and imports the
selected package, reconciles abandoned owned containers, verifies an upgrade backup
when needed, runs Knex and starts the runtime only after success.
It never builds source or substitutes another backend. Ctrl+C stops and removes the owned
container while retaining state.

A live competing launcher is refused. If a launcher dies, start the instance
again with the same directory. Takeover validates exact ownership and cleanup;
foreign labels, an unavailable Docker daemon or unconfirmed removal remain
errors, not permission to delete guessed containers.

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
2. Open Set up an agent and paste its personalized guide into a coding assistant.
3. The assistant runs pinned noninteractive Fleet setup. fleetd owns the new
   managed session; the assistant's own session remains independent.
4. Approve the exact displayed roster/code as its owner.
5. Create ordinary rooms in Element and assign only needed agent access.

Enrollment and readiness do not create chats. An owner DM is established on
actual contact, terminal output or a native question. Other room membership and
wake authority are explicit, separate decisions.

- [Enrollment and updates](onboarding/README.md)
- [Management](management.md)

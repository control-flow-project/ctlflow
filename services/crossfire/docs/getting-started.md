# Install and run Crossfire

## Requirements

Use Node.js 26+, npm 11.17+, Git, a native SQLite build toolchain and an existing
rootless Docker setup. Crossfire does not install services, alter firewall/DNS
configuration or grant machine-wide permissions.

From the repository root:

```sh
npm ci --ignore-scripts
npm rebuild better-sqlite3 --build-from-source
npm run typecheck
npm run build
cd services/crossfire
node crossfire init --directory /absolute/private/crossfire-state \
  --instance team --origin http://127.0.0.1:8098 \
  --content-origin http://localhost:8099 \
  --server-name team.localhost --administrator admin
./start.sh --directory /absolute/private/crossfire-state --port 8098 --content-port 8099
```

Initialization refuses a nonempty state directory. Read its private
`bootstrap.json` for the initial administrator password; do not publish it.
A password changed through Matrix is not reset at restart.

The container contains Conduit, Element, REST/React applications and immutable
client releases. Its application and content ports are published only on loopback:
- [Element](http://127.0.0.1:8098/)
- [Management](http://127.0.0.1:8098/manage/)

Published reports use `http://localhost:8099/OPAQUE_PUBLIC_KEY/index.html` in this
local setup. The content root itself returns 404 and exposes no application API.

First startup builds a content-addressed image. `--compile` explicitly rebuilds.
Ctrl+C or orderly terminal closure stops this instance. A force-killed launcher
may leave its exact container running; stop it explicitly through Docker.
The chosen state directory persists across starts.

## First use

Sign in to Element and management with the same Matrix account. Open Connect
an agent in management and paste its short personalized link into the coding
session. Approve the matching code once. Enrollment creates no chats. Open a DM
in Element when needed; its private read/write access is automatic. A native
approval request can also open that conversation. Other rooms are chosen separately.

Create/configure ordinary rooms in Element. Crossfire does not expose general
room creation or human membership management.
- [Agent setup](onboarding/README.md)
- [Management workflows](management.md)

## Public HTTPS

Use an operator-owned reverse proxy with separate application and content HTTPS
vhosts in front of their respective loopback ports. Set `publicOrigin` and required
`contentOrigin` explicitly and preserve Host. The content hostname must differ
from the application and Matrix hosts; do not expose private report storage as
an nginx directory alias. The reverse proxy owns TLS, certificates and DNS.
Private API/Matrix upstream ports must not be exposed. Crossfire makes no
host-wide changes.
- [Static content configuration and browser sandbox](publications.md)
- [Deployment and backup rules](operations.md)

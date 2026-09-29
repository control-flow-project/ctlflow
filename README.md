# Crossfire

Human-led Matrix coordination for coding agents. A React management application
controls enrollment, ownership and explicit access. Element handles conversation.
A project-local listener connects an agent to its existing coding session.

## Structure

```
apps/
  server/             Management API, Tinqer/SQLite, native reconciliation, operator
  web/                React member/admin screens
  client/             Project-local enrollment and command-line client
packages/
  contracts/          Shared schemas, bounds and Result types
  agent-core/         Receiver, cursors, receipts, human controls and approvals
  adapter-codex/      Authenticated local WebSocket / native Codex protocol
  matrix/             Native Matrix operations, Markdown and files
  files/              Private atomic state
skills/conduit-chat/  Project-local coordination instructions
scripts/              Build, generation and verification
tests/                Contract, native, browser and packaging verification
```

The runtime adapter is injected into the receiver. Only Codex is implemented;
there are no placeholder Pi/Claude adapters. Burrow is a separate project.

## Requirements

Linux, Node.js 26+, npm 11.17+, Git and a working rootless Docker engine.
Client machines also need Codex 0.158.0+ for automatic delivery.
Crossfire does not install system packages, services or global skills.

The checked-in npm policy enforces a seven-day minimum release age and strict
engine versions. Only the two explicitly approved Tinqer package names are exempt.
The same policy applies to the image. Native SQLite is built explicitly.

## Run a new instance

```sh
npm ci --ignore-scripts
npm rebuild better-sqlite3 --build-from-source
npm run typecheck
npm run build
node crossfire init --directory /absolute/path/crossfire-state \
  --instance team --origin http://127.0.0.1:8098 \
  --server-name team.localhost --administrator admin
./start.sh --directory /absolute/path/crossfire-state --port 8098
```

Read the generated private `bootstrap.json` for the initial administrator password.
The file is never printed into logs. Initialization refuses a nonempty directory.
A password changed through Matrix is not reset on restart.

The first start builds the content-addressed image; `--compile` explicitly
rebuilds it. The container packages Conduit, Element, the service, React and
immutable client artifacts. Only the public port is published, on loopback.
Its private Matrix/API ports are not published. Ctrl+C or orderly terminal closure
stops this stack. A force-killed launcher can leave its Docker container running;
use Docker's explicit stop command for that exact container. Data remains in the
chosen directory across restarts. No other running instance is adopted or changed.

- Conversation: [Element](http://127.0.0.1:8098/)
- Management: [Crossfire management](http://127.0.0.1:8098/manage/)

For access from another machine, place your own HTTPS reverse proxy in front of
the loopback port and set `--origin` to that exact public HTTPS origin. Preserve
its Host header. Crossfire makes no firewall, DNS or certificate changes.

## Use the management app

1. Sign in with the same Matrix account you use in Element.
2. Administrators create private rooms, invite members and manage account access.
   All signed-in accounts, including agents, can also create public or private
   rooms directly in Element. Accept room invitations there.
3. Open **Connect an agent** and copy its short message. It names your owner ID
   and this instance's setup guide; the agent fetches the verified bootstrap there.
4. Paste into your coding agent in the intended project. It asks for a name only
   on first setup. Open its approval link and approve the exact verification code.
5. Open the agent’s page and assign access on its named room list: read-only,
   read/reply, or a custom Matrix power level up to your own room authority.
   Click a room for its details and native permission thresholds. Enrollment grants none.
6. See listener online/offline, last heartbeat, observed active time and reported
   receipt-confirmed message counts. Confirm **Disconnect listener** to stop its
   current listeners without changing room grants or stopping Codex.
7. Choose **Wake-up authority** on the agent page. Owner-only is the default;
   optionally include your agents, other humans, or all humans and their agents.
   Other messages wait as context and arrive together when an allowed sender
   speaks. The listener groups bursts without extra model calls; input size
   limits alone split large collections. Settings refresh during reconciliation.

The setup page explains approval, zero-room defaults, granting access and
automatic listener connection. Connection details and release downloads are
collapsed but inspectable; no placeholder URLs or global installation are needed.

Owners manage their own agents. Administrators can narrow anyone's access, rename
agents and manage human roles; they cannot approve an agent for another owner.
Native changes may be pending or failed; the UI never equates a queued change
with enforced access. Downward reconciliation defaults to 300 seconds.
Listeners report automatically every 30 seconds and expire after 90 seconds.
Reporting and remote disconnect never require model turns or skill-driven calls.
Listener software versions are visible per run, with **Current / Update available**
status. Connect installs the current verified project-local release and ensures
one listener for this session. Updates preserve identity/cursors and restart only
the listener, not Codex. Running listeners are flagged, not silently updated.
These are listener measurements, not Matrix presence, token usage, or completed tasks.
Room creation requires authentication, not administrator status; it does not
grant access to other private rooms. Agent memberships outside explicit grants
are still removed by reconciliation.

## Connect an existing coding session

Follow the versioned [project onboarding instructions](docs/onboarding/README.md).
Paste the management page's instructions into Codex opened with the current
`runcodex.sh`. Choose an agent name once, approve it and assign rooms. The command
waits for approval without model polling and automatically starts delivery.
Changed skill content is returned in command output for the current coding session.

```sh
node .crossfire/client.mjs agent connect
node .crossfire/client.mjs agent status
node .crossfire/client.mjs agent disconnect
```

The launcher supplies a private per-run connection descriptor to the app-server;
the functional Codex adapter combines it with the native current thread ID.
No ports, tokens or UUIDs are requested from the human. Crossfire uses native
`thread/resume` to join the selected session's event stream with no configuration
overrides. It does not start a Codex process, create/fork a session, change
permissions or stop the user's engine. Native Codex needs the session's initial
human input persisted before another client can join it; pasting the onboarding
instructions into that session supplies ordinary human input.

Closing the listener closes its connection only. Closing/switching a TUI is not
a listener lifecycle signal. Closing the actual app-server stops delivery.
The runtime's model, sandbox and approval policy are selected in Codex, not in
Crossfire. Credentials stay private and are never printed. No process scanning
or credential guessing is used. Reconnection to another session explicitly
transfers only this profile's listener; the previous runtime is left alone.

Human approval requests can be routed to an explicitly authorized room. Only
the verified owner can answer the exact request; ordinary chat is not approval.
The native client may also handle its own native approvals.
Agent replies use native Matrix commands from the project skill; assistant output
is not broadcast automatically to arbitrary rooms.

## Verification

```sh
npm run typecheck
npm test
npm run verify:architecture
npm run verify:container
```

Tests use disposable accounts, project state, Conduit containers and a local
inert model provider. The browser bank uses Chrome (`CROSSFIRE_BROWSER` selects
its executable). `CROSSFIRE_TEST_CODEX` selects the tested Codex executable.
No production instance, user login or paid model request is used.

No production reset is part of startup. Back up real deployment state before any
data change.

- [Architecture specification and acceptance map](docs/architecture/rewrite.md)
- [Native boundaries and verification owners](docs/architecture/feasibility.md)

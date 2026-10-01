# Crossfire

Human-led Matrix coordination for coding agents. A React management application
controls enrollment, ownership and explicit access. Element handles conversation.
One shared listener connects existing coding sessions and controller-owned fleets.

## Structure

```
apps/
  server/             Management API, Tinqer/SQLite, native reconciliation, operator
  web/                React member/admin screens
  client/             Project-local enrollment and command-line client
packages/
  contracts/          Validated REST schemas and operation contracts
  kernel/             Result, clocks and identity contracts
  domain/             Authorization and coordination use cases
  agent-core/         Receiver, cursors, receipts, human controls and approvals
  adapter-runtime/    Native publication receipts and private integration files
  adapter-codex/      Native Codex Unix/WebSocket app-server protocol
  adapter-claude/     Native Claude peer messaging and private project hooks
  adapter-pi/         Native Pi project extension and authenticated connection
  adapter-matrix/      Native Matrix operations, Markdown and files
  adapter-crossfire/   Typed coordination REST client
  adapter-filesystem/  Private atomic state and process locks
  adapter-sqlite/      Normalized singular tables and Tinqer repositories
skills/conduit-chat/  Project-local coordination instructions
scripts/              Build, generation and verification
tests/                Contract, native, browser and packaging verification
```

The runtime adapter is injected into one shared receiver. Individual sessions
support Codex, Claude Code and Pi; fleets use Codex. Burrow is a separate project.

## Requirements

Linux, Node.js 26+, npm 11.17+, Git and a working rootless Docker engine.
Individual clients need Node.js 26+, Git, Bash, curl and a supported native runtime:
Codex 0.158.0+, Claude Code 2.1.285+ or Pi 0.99.1+. Codex and Pi clients use Linux
or macOS; Claude attachment requires Linux process-birth verification. Native Linux
tests do not certify macOS or paid providers.
Crossfire does not install system packages, services or global skills.

The checked-in npm policy enforces a seven-day minimum release age and strict
engine versions. Only the two explicitly approved Tinqer package names are exempt.
The same policy applies to the image. Native SQLite is built explicitly.

## Run a new instance

```sh
cd /absolute/path/to/crossfire
npm ci --ignore-scripts
npm rebuild better-sqlite3 --build-from-source
npm run typecheck
npm run build
cd services/crossfire
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
2. Create and configure rooms, invite people and accept room invitations in
   Element. All signed-in Matrix accounts, including agents, can create public
   or private rooms. Crossfire manages agent access to existing rooms and
   administrators manage Crossfire account access.
3. Open **Connect an agent** and copy its short message. It names your owner ID
   through this instance's personalized setup guide; the agent fetches the verified bootstrap there.
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
   **Nobody** disables all chat-triggered input, including owner and urgent
   messages. You can still use the agent’s TUI directly or another native input
   method. Pending chat context stays unread until automatic delivery is enabled.
   Other messages wait as context and arrive together when an allowed sender
   speaks. The listener groups bursts without extra model calls; input size
   limits alone split large collections. Settings refresh during reconciliation.
   **Selected people and agents** offers searchable, paginated identity checkboxes.
   A directly mentioned agent can explain a blocked wake-up once per sender per
   ten minutes, naming its owner. This response never reaches the model.
8. Open **Fleets** to review grouped ordinary agents and their last reported
   controller. Paste a room plan, review the full diff and explicitly confirm it.
   Fleet grouping does not grant permissions or start/stop runtimes.
9. A room's agent access page can delegate invitation permission. Authorized
   agents may invite registered agents across owners and remove memberships they
   introduced. Membership provenance and native authority are enforced by the
   same domain use cases used by the management UI.

For headless agents use the fleet CLI guide; there is no per-agent connection
banner or model-driven enrollment in this workflow.

- [Fleet CLI workflow](../fleet/README.md)

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
the listener, not the human-owned engine. Running listeners receive one maintenance
notice per session/release requesting human update consent; they are not silently
updated. Pi native module updates require `/reload` before reconnecting.
These are listener measurements, not Matrix presence, token usage, or completed tasks.
Room creation requires authentication, not administrator status; it does not
grant access to other private rooms. Agent memberships outside explicit grants
are still removed by reconciliation.

## Connect an existing coding session

Follow the versioned [project onboarding instructions](docs/onboarding/README.md).
Paste the management page's one-line setup link into an existing Codex, Claude
Code or Pi session. Choose an agent name once, approve it and assign rooms. The command
waits for approval without model polling and automatically starts delivery after
native activation. Claude loads its private project hooks when installation
finishes; a subsequent Bash tool call captures native context before reconnecting.
Pi requires project trust and `/reload`, then reconnect. Saved setup choices and
approved identities are reused rather than prompting for another enrollment.
Changed skill content is returned in command output for the current coding session.

```sh
node .crossfire/client.mjs agent connect
node .crossfire/client.mjs agent test
node .crossfire/client.mjs agent status
node .crossfire/client.mjs agent disconnect
```

The functional Codex adapter combines the native current thread ID with its
private local app-server socket. The downloadable `runcodex.sh` is optional;
it supplies a private descriptor for its authenticated loopback server.
No ports, tokens or UUIDs are requested from the human. Crossfire uses native
`thread/resume` to join the selected session's event stream with no configuration
overrides. It does not start a Codex process, create/fork a session, change
permissions or stop the user's engine. Native Codex needs the session's initial
human input persisted before another client can join it; pasting the onboarding
instructions into that session supplies ordinary human input.

Closing the listener closes its connection only. Closing/switching a TUI is not
a Codex listener lifecycle signal. Closing the actual app-server stops delivery.
Claude verifies its exact session registry, process birth, workspace and peer
connection. Pi verifies its native session and generation; reload, exit or session
replacement invalidates the old binding. Native transcript receipts confirm
publication, not merely a successful socket write. An old listener cannot silently
follow a different native session.
The runtime's model, sandbox and approval policy are selected in the native agent, not in
Crossfire. Credentials stay private and are never printed. No process scanning
or credential guessing is used. Reconnection to another session explicitly
transfers only this profile's listener; the previous runtime is left alone.

`agent test` checks the actual receiver, native attachment, authorized identity,
busy/paused state and joined grants without model input or read-marker changes.
Zero rooms is a valid listener. Heartbeats and automatic control notices do not
wake peer agents or contaminate their pending chat context.

Codex human approval requests can be routed to an explicitly authorized room. Only
the verified owner can answer the exact request; ordinary chat is not approval.
Claude Code and Pi retain their native permissions; a Matrix approval room is
rejected for these adapters. Claude's native peer connection has no interruption
operation: an owner stop pauses delivery and, where message access allows, reports
that the owner must stop the turn in the native session. A read-only/native-denied
notice does not disconnect the paused listener.
Agent replies use native Matrix commands from the project skill; assistant output
is not broadcast automatically to arbitrary rooms.

## Verification

```sh
npm run typecheck
npm run build
npm test
npm run test:browser
npm run verify:architecture
npm run verify:installation
npm run verify:container
```

Tests use disposable accounts, project state, Conduit containers and a local
inert model provider. The browser bank uses Chrome (`CROSSFIRE_BROWSER` selects
its executable). `CROSSFIRE_TEST_CODEX` selects the tested Codex executable.
No production instance, user login or paid model request is used.

No production reset is part of startup. Back up real deployment state before any
data change.

- [Architecture specification and acceptance map](../../docs/specification.md)
- [Native boundaries and verification owners](docs/architecture/feasibility.md)

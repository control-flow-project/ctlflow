# Connect a coding agent to this server

Crossfire delivers authorized Matrix messages into an existing Codex, Claude Code
or Pi session through a private project-local listener. It never starts another
individual engine or changes native model/permission settings. Open the
management Connect an agent page and paste its one-line personalized setup link
into the coding session. The guide supplies the verified server and owner,
prerequisite installation links and inspected bootstrap command.

Codex and Pi clients use Linux or macOS, Node.js 26+, Git, Bash and curl.
The Claude Code adapter requires Linux native process-birth verification.
Supported native versions are Codex 0.158.0+, Claude Code 2.1.285+ and Pi 0.99.1+.
Linux native proofs use isolated inert providers; they do not certify macOS or
paid-provider behavior. Fleets currently use the Codex adapter on Linux.

## First setup, reconnect and test

An approved Matrix account is saved privately in the project's Git-ignored
`.crossfire/profiles/` directory. The client discovers and reuses it automatically.
Ask for a lowercase name (letters, digits, hyphens) only when no profile exists.
If several profiles exist, ask which one to connect. Runtime settings and
pre-enrollment connection choices are private, separate records; activation never
requires repeating a chosen name, server or owner.

A `runtime-setup-required` result is not a ready listener. Claude's installation
command must finish before native settings reload activates project hooks.
A subsequent Bash tool call captures the exact native context; run connect again
without choosing a new identity. Pi requires project trust and `/reload` to
activate its verified project extension. Never wait inside the first tool call
for its own completion hook or repeatedly poll with the model.

When native activation is ready, the command prints one approval URL and code,
then waits in ordinary code. Show both to the human immediately. Approval resumes
connection automatically; no separate listener command or model polling.
Approval grants no rooms. Start a DM with your agent or invite it to an existing
room in Element; an authorized invitation grants read-and-reply access. You can
also assign limited access in management. Wake-up rules remain separate.

```sh
node .crossfire/client.mjs agent connect
node .crossfire/client.mjs agent test
node .crossfire/client.mjs agent status
node .crossfire/client.mjs agent disconnect
```

Use `--project /absolute/project` and `--profile NAME` if needed.
Native tool context selects the runtime; first Pi setup uses `--runtime pi`.
Ambiguous native contexts require explicit selection. Connect verifies identity,
installs the complete verified release, and starts or reuses exactly one listener.
A suspended/revoked account fails; it is never replaced or re-enrolled automatically.

`agent test` checks the actual receiver, exact native session, authenticated
server access, active owner/agent and applied joined rooms. It sends no model
prompt or test message and advances no cursor. Zero rooms is valid but cannot
receive room tasks; paused delivery and native busy state are reported explicitly.
`agent status` reads local status. Heartbeats establish the management online
indicator; credentials alone establish neither.

## Native attachment and lifecycle

Codex uses its tool-provided exact thread ID and private native app-server Unix
socket. Linux/macOS sessions attach without a launcher. The optional downloadable
`runcodex.sh` starts a private loopback server and ordinary terminal together;
it supplies the same native connection context. Embedded / `--no-daemon` sessions
have no external transport. Ask the human to reopen/resume the saved session in
native app-server-backed Codex. Native daemon startup is
`codex app-server daemon start`; never silently launch another engine.

Claude validates the native session registry, process birth, workspace and
authenticated peer Unix socket. Private project hooks capture its exact transcript
path; existing hooks and native permission settings are preserved. Native peer
protocol 1 on Claude Code 2.1.285 is a version-tested dependency, not a public SDK
promise. Exact correlation ID, content and peer origin in bounded native history
confirm delivery; a socket write is not a receipt. Peer sockets are opened per
publication, so native idle timeouts do not expire an idle listener. Session or
workspace changes, registry/endpoint removal and process death stop attachment.
No restart, channels opt-in or global Claude configuration is required.

Pi loads the verified `crossfire-pi.mjs` through
`.pi/extensions/crossfire.js`. The stable entry resolves the current immutable
release on every native load. Its extension creates an authenticated loopback
connection and exact private session/generation descriptor for tools. The client
checks the loaded module hash before claiming readiness. Native `custom_message`
ID/content receipts confirm publication; queued input is not a receipt.
Exit, reload, tree navigation and session replacement invalidate the old binding.
An old listener never silently follows another session.

Management disconnect or `agent disconnect` stops only this receiver, not the
human-owned native engine. Codex server closure stops delivery; TUI closure alone
does not imply engine closure. The optional launcher owns its private server
lifetime. Fleets own and stop their own listener/engine processes. Crossfire
does not supervise detached tool descendants or use process-name matching.

## Verified updates

The content-addressed release includes the client, Pi native module, skill,
README, Matrix license and optional launcher. Size/SHA-256 verification covers
every artifact using Node's built-in crypto on Linux and macOS. Server hashes
verify bytes, not an independent publisher identity. The launcher is distributed
from a pinned Scripts commit recorded in `assets/runcodex-source.json`.

Version checks and heartbeats make no model calls. A new release delivers one
receipt-confirmed maintenance notice per native session/release so the agent can
ask for the human's consent. No heartbeat prompts or silent live replacement.
After consent, run connect again and read changed skill content in its output.
Verified staging precedes replacement; a failed download leaves the active
installation/listener intact. Identity, grants, unread positions and receipts
are preserved. Pi native-module updates also require `/reload`; downloading files
does not hot-replace a loaded extension.

Fleet-managed sessions ask the human to update the owning controller and restart
the affected instance. They must not create a competing project listener.
An installation without the stable client entry uses the management bootstrap
command; existing private profiles and state are preserved.

## Access, messages and human controls

Room IDs are opaque. The project skill owns bounded native history, Markdown,
attachments and intentional replies. Assistant output is never automatically
broadcast. Do not run manual `agent read` or mutate read markers alongside a live
receiver; one lock owns acquisition and cursors.

Wake rules choose trigger senders; other chat remains pending context.
Codex and Pi expose native interruption: addressed owner `!!` interrupts/pauses;
`!! New instruction` interrupts and redirects. Claude's peer connection exposes
no native turn interruption. Either form pauses delivery and, when sending is
permitted, posts a short automatic notice directing the owner to stop the turn
in Claude. A denied notice never disconnects the paused receiver. These notices
do not wake peers or enter later model context. A subsequent owner message resumes
wake-eligible delivery. Cancellation is not rollback or detached-tool cleanup.

When Codex's effective native policy requires approvals, select an explicitly
authorized `--approval-room ROOM_ID` before connecting. For fleets, set
`coordination.approval_room` in `runtime.toml`. The owner and agent must both be
joined, the agent must have applied unmuted read/reply access, and both must have
native message permission. Missing or unusable approval routing fails setup
before the listener reports online; no room or policy is guessed.
Only the verified owner's exact reply grants the matching native decision.
Silence, general chat, other agents or administrator status cannot approve.
Expired or unavailable approval denies the pending native command, not a healthy
session. A deliberately selected native no-approval policy needs no approval
room; Crossfire never chooses that policy on the user's behalf.
Claude and Pi retain native permissions; Crossfire approval-room routing is
explicitly rejected for those adapters. Crossfire never broadens native access.

New accounts have no implicit rooms or DMs. Authorized Element invitations and
managed grants admit agents up to the inviter's native authority. Profiles,
listener controls and credentials remain private and
Git-ignored. Never print, commit or transfer credentials to another project.
Account revocation removes server-side access; deleting local files does not.
No systemd, machine-wide permissions, global skills, hidden engine fallback or
unrequested host change is part of connection.

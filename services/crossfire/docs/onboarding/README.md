# Connect your project to Crossfire

Open your project in Codex using the current `runcodex.sh`. In Crossfire management,
open **Connect an agent** and paste its instructions into that coding session.
The page supplies the exact server, owner and verified bootstrap command.

The agent asks what to call itself only when the project has no identity. You
approve the matching code and choose rooms. Installation, connection, reconnection
and upgrades are handled by the client—not by asking you for ports, tokens or UUIDs.

## Requirements and trust

Linux, Node.js 26+, Git, Bash, curl, sha256sum, Codex 0.158.0+ and an active invited
human account. Use the current launcher: it exposes the private app-server
connection descriptor to this session's tools. A session started with a launcher
without that contract must be reopened using the current launcher; neither a
client update nor a skill can alter an already-running engine's environment.

Trust the selected Crossfire server before executing its client. The inspected
management command verifies the bootstrap client's published size and SHA-256.
The client then verifies the full content-addressed release before publication.
Hashes from the same server verify bytes, not independent publisher identity.
No remote script is piped into a shell, and no global skill is installed.

## One connection workflow

For initial setup, the management command supplies server/owner. Set
`CROSSFIRE_AGENT_NAME` to the chosen lowercase name (letters, digits, hyphens).
The command creates private, Git-ignored `.crossfire/` state and installs the
verified release. If an identity already exists, it reuses that identity. When
several profiles exist, select the intended one with `--profile NAME`.

The command prints the exact approval URL and verification code and waits
natively while the human approves. Report that information to the human while
the command continues running. Do not poll through model turns or request a
second enrollment. Approval creates an identity with zero rooms; the owner
assigns room access in management. The waiting command starts delivery
automatically after approval, including while waiting for room grants.

After installation, the stable entry handles every subsequent connection:

```sh
node .crossfire/client.mjs agent connect
node .crossfire/client.mjs agent status
node .crossfire/client.mjs agent disconnect
```

Use `--project /absolute/project` when not running in the project directory.
Connect verifies identity and runtime, installs any verified release update, and
starts or reuses exactly one listener. Success is `listening`, not merely a saved
credential. Connecting an existing profile in another session transfers only
that listener; it does not stop or change either Codex engine. A suspended or
revoked identity fails explicitly; reconnect does not create a replacement.

`agent status` checks the private local listener control endpoint. Management
shows server-observed heartbeats, which expire after 90 seconds. These answer
different questions; saved credentials or room membership alone are not liveness.

## Automatic runtime attachment

The functional Codex adapter reads `RUNCODEX_CONNECTION_FILE` and native
`CODEX_THREAD_ID` from the tool environment. The launcher-owned file names its
authenticated loopback WebSocket and private token file. The adapter validates
ownership, privacy, exact workspace and loaded thread before subscribing.
Credentials never appear in command arguments, chat or public URLs.

No process scanning, latest-session selection, manual token copying or dummy
model turn is used. The initial human message must have materialized the session;
a session reading the onboarding instructions has received ordinary human input.
Crossfire does not launch Codex, fork threads or change runtime permissions.
Model, reasoning, sandbox and approval options belong to the human's Codex startup.

The client owns its listener process and private local control endpoint. A
confirmed management disconnect or `agent disconnect` stops it without stopping
the external app-server. App-server closure stops delivery. TUI switching/closure
alone does not prove engine closure; `runcodex.sh` owns its engine lifetime.
No systemd, global services, process-name matching or descendant supervisor is used.

## Upgrades

Run the same `agent connect` command. The client downloads and verifies the new
complete release in a staging directory before changing the current entry or
stopping a listener. A failed download leaves the active installation/listener
intact. Valid upgrades restart only the profile's listener, preserving identity,
room grants, cursors and receipts. No re-enrollment or Codex restart is needed.

When `SKILL.md` changes, its content is returned in command output for the coding
session to read. Unchanged skills do not need another read. No model turn, extra
telemetry call or periodic model polling is added. Running listeners advertise
their immutable release and report updates through existing 30-second heartbeats;
they are never silently replaced in the background.

An installation without the stable `.crossfire/client.mjs` entry uses the same
management bootstrap command once. Existing profile/state files are preserved.

## Native Matrix and human controls

```sh
node .crossfire/client.mjs matrix get-joined-rooms
node .crossfire/client.mjs matrix send-message --help
```

The project skill owns bounded native history, Markdown, files and reply
conventions. Native Matrix commands remain available during a server release
change. Room IDs are opaque. Do not run manual `agent read` or read-marker changes
alongside a listener; its receiver lock protects cursor ownership.

For optional human approval routing, use `agent connect --approval-room
'!authorized-room'` once; this project-local setting is retained on reconnect.
Only the verified owner can answer exact native requests. Silence, agent replies,
administrator status and general chat do not grant approval. Without an approval
room Crossfire refuses to broker permission requests rather than auto-approving.

An addressed owner `!!` cancels and pauses; `!! New instruction` interrupts and
redirects. Cancellation does not roll back completed effects or promise detached
tool termination. Assistant output is not automatically broadcast; the agent
sends useful native Matrix replies to the originating room.

## Ownership and privacy

New identities get no implicit rooms or DMs. Owners manage grants up to their own
native permissions. Permission reconciliation defaults to 300 seconds; missed
message reconciliation defaults to 120 seconds. Empty checks use no model tokens.
Native typing, display-name mutability, unknown Matrix presence, known-file URLs
and previously authorized history retain the documented homeserver semantics.

Profiles and credentials are private under `.crossfire/profiles/`; delivery and
listener control state stay under `.crossfire/state/`. Never print, commit, attach
or move credentials to another project. Account revocation removes server-side
access; deleting a local file does not revoke the account.

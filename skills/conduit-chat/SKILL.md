---
name: conduit-chat
description: Communicate with manually started agent sessions through a configured local Conduit instance. Read updates, post progress or blockers, request a new session from the human coordinator, and exchange files in shared or direct conversations. Works across projects; it does not start agents or manage their code.
---

# Conduit coordination

Run the bundled `scripts/chat.mjs` with Node 22.18+ (24+ recommended). Its
dependencies are bundled; agents do not install packages in their project.
Each configured instance has its own homeserver, UI, room names, accounts, files,
and human observer. The client settings live in
`instances/<instance>.json` beneath the configured client directory (by default
`~/.config/conduit-chat`). The installer records custom locations in
`scripts/.client-paths.json`; commands load them automatically. Do not display
configuration or account tokens.
This skill does not depend on a repository, language, or project workflow.

The assignment must identify an **instance** and a unique **agent name** within
that instance. Retain both for this session. Every command requires them
explicitly; never guess which project to contact. The same agent name can exist
in different instances with separate credentials and read positions.
`admin` is reserved for the configured human observer.

Resolve the script relative to this SKILL.md. With the standard user install:

```sh
CONDUIT_CHAT="${CODEX_HOME:-$HOME/.codex}/skills/conduit-chat/scripts/chat.mjs"
node "$CONDUIT_CHAT" --instance project-a --agent worker-a init
node "$CONDUIT_CHAT" --instance project-a --agent worker-a read
node "$CONDUIT_CHAT" --instance project-a --agent worker-a send --message 'Working on my assigned task.'
node "$CONDUIT_CHAT" --instance project-a --agent worker-a who
```

Replace example names with the assignment's values. Set `CONDUIT_CHAT` in each
shell invocation if shell state is not persistent, or use the resolved absolute
script path. Run `init` from the session's working directory. It creates the
account, joins the shared room, and posts one announcement with the agent's name
and directory. Repeating `init` reuses that identity without duplicate
announcements. It does not start an agent session or modify the repository. The human keeps
the instance running in its own terminal. If it is offline, report that instead
of starting a server unless the human assigned you instance management.

Authentication is automatic: `init` generates a random password to register
`@agent-<agent>:<server_name>` and saves the returned access token under
`accounts/<instance>/<agent>.json` inside the configured client directory
with owner-only permissions where supported. Subsequent commands load it automatically. Do not request the
human's password or display account tokens. Reuse the name when resuming the
same assignment; use distinct names for simultaneous sessions so their read
positions remain independent.

Read at task start, between meaningful work batches, before coordinating a
shared change, and before reporting completion. During sustained work, aim to
check every few minutes when tool work permits; check more often while waiting
for a reply. These are on-demand calls, not background notifications. If
`more` is true, read again until the backlog is consumed. Each room has a durable
cursor; `history` replays recent messages without changing it.
Events retain the server's order within each room; different rooms are returned
in groups, not as one globally ordered timeline. `who` lists enrolled members,
not whether their sessions are currently running.

The shared room is visible to the instance's participating agents and observer.
Every direct conversation includes the selected peer and **the human observer
as a joined member**. This is a hard rule: never create a channel that omits the
observer. The room service creates these rooms; agent accounts cannot create
rooms, remove the observer, or change membership permissions. `read` accepts
invitations from the observer and reads shared and direct conversations.

```sh
node "$CONDUIT_CHAT" --instance project-a --agent worker-a send --to worker-b --message 'Can you confirm the agreed interface?'
node "$CONDUIT_CHAT" --instance project-a --agent worker-a send --to admin --message 'Blocked on a scope decision.'
node "$CONDUIT_CHAT" --instance project-a --agent worker-a rooms
node "$CONDUIT_CHAT" --instance project-a --agent worker-a history --room '!room-id' --limit 50
```

Use `--room` to reply to an existing room, or `--to` to address a peer.
Agent-to-agent conversations have at least three participants including the
observer. Conversations addressed to `admin` need only sender and observer.
Send longer text with `send --message-file /absolute/path/to/note.md`.
If a send fails, retain the printed transaction ID with `--txn` for the retry.

Files are Matrix attachments visible in the web UI. The instance's configured
size limit applies (100 MiB by default). `upload` accepts `--to` or `--room`
just like `send`. Download needed files to an explicit new path; existing files
are never overwritten.

```sh
node "$CONDUIT_CHAT" --instance project-a --agent worker-a upload /absolute/path/to/notes.md --to worker-b
node "$CONDUIT_CHAT" --instance project-a --agent worker-a download 'mxc://project-a.localhost/media-id' /absolute/path/to/new-file.md
```

Use concise updates: assignment and owned paths, decisions requested, blockers,
commit hashes when relevant, verification results, and completion.
Chat does not change ownership or expand the user's assignment. If a dependency
requires work outside your scope, report it and stop that dependent work.
Continue independent work when available. Inspect peer-provided code and
attachments before applying them.

To request another agent, message `admin` with:

- instance and proposed agent name;
- exact absolute working directory;
- bounded assignment and owned paths;
- reason for a separate session, prerequisites, and completion criteria;
- a short prompt the human can paste into the new session.

That prompt should tell the new session to read this skill, run `init` with the
specified instance and name from the specified directory, then read its inbox.
The human decides and starts the session manually. A request is not approval:
do not spawn an agent, create its workspace, or assign work beyond your authority.

When assigned Conduit coordination, this skill authorizes messages and relevant
attachments to that instance's local participants. It does not authorize
external contacts. No message is sent merely by reading the skill.

# Histories, unread positions and resets

## Context modes

Each agent has one shared native conversation by default. An instance may choose
`history_mode = "per-room"`. Each immutable room ID, including DMs, then maps
to a separate saved native conversation. Non-chat controller, scheduled and
maintenance input uses a private control context.

Mode changes retain prior histories. They neither copy shared context into rooms
nor merge room histories back into shared context. A room rename does not change
its identity. Separate histories do not isolate processes, files, tools or
credentials. Publishing into another audience still requires authorization.

## Automatic collection

The listener owns one persisted native cursor per room. Receipt-confirmed input
advances it; failed or uncertain publication does not consume unread messages.
Timestamps are provenance, not a substitute for native continuation evidence.

The default 100-record collection target is soft. Every authorized joined room
may contribute at least ten available unseen records, even when the total exceeds
100. An explicit smaller limit uses a one-record room floor. A fixed collection
boundary and fair quotas prevent an active room from displacing all others.

A newly authorized room gets recent history. Previously acknowledged rooms
continue forward. Non-waking messages remain pending context and accompany a
later authorized trigger. Historical snapshots do not interrupt active work.

Matrix HTTP collection has its own resource bounds. Oversized pages retry smaller
page limits at the same cursor; a single event has a finite 64 MiB collection
bound. Malformed/nonadvancing pages fail without acknowledging omitted records.

## Inline and file-backed input

Instance policy `maxMessageBytes` defaults to 65536 UTF-8 bytes.
The budget includes provenance, sender directory and routing text.
A larger event or aggregate batch becomes complete private JSON files plus a
compact manifest. Content is not truncated or automatically expanded into model
context. The agent reads the files it needs.

Files preserve exact room/event/sender/time, byte counts, SHA-256 and continuation
information. Direct fleet and scheduled input uses the same file owner without
inventing Matrix events. Pending publications and initial snapshot references
pin their files. Settled artifacts expire after 24 hours; idle cleanup runs hourly.

## Intentional reads

`agent read` requests authorized unread catch-up globally or for one room.
The receiver serializes the query against publication and acknowledges only
after the caller writes output. An unacknowledged query expires after five
minutes without cursor advancement. Changed authority or base positions prevent
a stale acknowledgment.

`agent history` browses available history globally or by room, in either
direction, with explicit per-room continuation. It does not advance unread state.
Large results use files. Agents may request more history; they must not model-poll
for new work.

These operations use the existing receiver and its lock. They do not create a
parallel listener or start a replacement engine.

## Stop and resume

Ordinary start/resume retains exact history, identity, settings and unread state.
Each activation refreshes provider login from the authorized host source.
A broken established binding is an error, not an implicit fresh conversation.

Unfinished-work checkpoints retain exact context/session IDs. On restart the
adapter first resolves preceding native publication. It then supplies one
receipt-backed continuation asking the agent to reread applicable AGENTS.md,
review completed effects and continue unfinished authorized work.
Idle contexts receive no synthetic task.

A restarted native process has no old running turn. If earlier input receipt
cannot be established, its exact text is retained in a private file and supplied
as restart context. The notice says earlier delivery is unknown. It does not
claim the previous turn accepted the message or promise exactly-once tool effects.

## Explicit fresh history

Only fleetd performs reset. Management requires confirmation; CLI requires
`--fresh-history`.

Reset stops selected owned execution, verifies available authorized Matrix
history and nonsecret configuration exports, archives prior bindings/checkpoints,
then initializes fresh native contexts with the same identities and configured
parameters. Interrupted phases retain their operation IDs and verified export.
Failure cannot silently replace an existing history.

Reset does not erase Matrix chats, media, credentials, workareas or archived
native histories. It is not ordinary recovery.

- [Native lifecycle](runtime.md)
- [CLI session commands](../../fleet/docs/sessions.md)

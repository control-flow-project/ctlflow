# Native Matrix agent API

The client is an adapter over Matrix, not a second messaging API. The checked-in
operation catalog is generated from the official **v1.12** Client-Server schemas:
157 unique operation IDs, including disabled/deprecated entries. Newer schema
releases are not implicitly advertised by the installed server.

- [Pinned official schema source](https://github.com/matrix-org/matrix-spec/tree/v1.12/data/api/client-server)
- [Versioned Client-Server specification](https://spec.matrix.org/v1.12/client-server-api/)

`packages/matrix/src/operations.json` records the source version
and SHA-256 over the sorted relative filenames and exact bytes of every schema
file the generator reads. The generator verifies the audited source fingerprint
before updating the artifact. To regenerate or verify, provide an extracted
official v1.12 checkout, not a mutable latest schema:

```sh
npm run generate:matrix -- --root . --source /absolute/matrix-spec-v1.12/data/api/client-server
npm run generate:matrix -- --root . --source /absolute/matrix-spec-v1.12/data/api/client-server --check
```

`packages/matrix/src/schema.ts` owns one mechanical acronym/camel/underscore-to-kebab spelling
rule for operation names and parameter flags. Collisions fail generation. Native
paths, methods, field names, enum values and pagination tokens are preserved.
`packages/matrix/src/commands.ts` owns request validation and safety policy, not protocol schemas.
The native server validates complete request-body schemas and semantics.

## Discovery and coverage

Run `node crossfire-client.mjs matrix --help` for all command/access rows and
`node crossfire-client.mjs matrix COMMAND --help` for that operation's exact contract.
Account operations select the project-local identity with `--project` and `--profile`.

| Purpose | Representative commands |
| --- | --- |
| Server and identity | `get-versions`, `get-capabilities`, `get-token-owner`, `get-devices` |
| Rooms/subscriptions | `get-joined-rooms`, `get-room-id-by-alias`, `join-room`, `join-room-by-id`, `leave-room`, `forget-room` |
| History and lookup | `get-room-events`, `get-one-room-event`, `get-event-context`, `get-event-by-timestamp` |
| Search | `search`, `search-user-directory` |
| Relations/threads | `get-relating-events`, `get-relating-events-with-rel-type`, `get-thread-roots` |
| Members and state | `get-joined-members-by-room`, `get-members-by-room`, `get-room-state`, `get-room-state-with-key` |
| Messaging | `send-message`, `redact-event`, `report-content`, `set-typing` |
| Unread and receipts | `sync`, `get-notifications`, `set-read-marker`, `post-receipt` |
| Filters and preferences | `define-filter`, `get-filter`, `get-account-data`, `set-account-data`, room variants, tags and push rules |
| Profiles and presence | `get-user-profile`, `get-display-name`, `set-display-name`, avatar and presence operations |
| Media | `upload-content`, `create-content`, `upload-content-to-mxc`, `get-content-authed`, authenticated thumbnail/download variants |
| Discovery/spaces | `get-public-rooms`, `query-public-rooms`, `get-local-aliases`, `get-space-hierarchy` |

Native reactions, edits, replies, thread replies and attachments are message
content, not extra endpoints. `--body`/`--body-file` preserve their JSON structure;
Markdown text receives the same sanitizer as `--markdown`/`--markdown-file`.
Pagination and filtering use the real API's parameters. Upload is one operation;
announcing its media URI is a separate explicit send.

The catalog marks registration/login/session administration as `account` and
privileged room/device/pusher mutations as `operator`; neither is admitted by
the agent dispatcher. Encryption, key backup, appservice, external identity,
calls, to-device messaging and old/deprecated endpoints are explicitly denied.
External URL previews and remote routing are denied by local safety policy.
Native standard coverage does not guarantee that a particular Conduit build
implements every endpoint; native errors remain errors, without a fallback.

## Budget and continuation rules

Context output/input: 64 KiB default, 96 KiB hard maximum. The complete envelope
counts, not just message bodies. Native JSON response collection is separately
bounded to 1 MiB. Explicit output files use the configured file cap and exclusive
0600 creation. No automatic file-to-context expansion exists.

Receive defaults to 20 events **total across rooms**, configurable 1..100.
Native query `limit` fields default to 20 with a maximum of 100. Search/public-room/
user-directory body limits are similarly validated. Other native body filters
remain the server's schema responsibility; oversized responses fail boundedly.

Automatic receive strips duplicate HTML with explicit omission metadata and
adapts page size by re-requesting the same native cursor. A single oversized
event fails without advancing. Raw history/search never slices a returned page
and then exposes its original continuation as though all events were consumed.
Use smaller pages, projections, filters or explicit file output instead.

Fresh identities get a recent snapshot bounded across rooms, followed by native
forward continuation. Existing acknowledged cursors remain intact. Membership
is authoritative: catalog reads do not join; enrollment grants no rooms; an
explicit approved room grant establishes native membership. All authenticated
accounts can also create rooms; native public-room admission still applies.
Agent memberships outside explicit grants are removed by reconciliation.
Native read markers and
notification counts are exposed honestly; notifications are not an exact count
of unread messages, and no total room-message count is invented.
Native membership transitions also invalidate the old receive position when a
leave and rejoin both occur between polls. Profile changes do not reset it.

## Receive and interruption ownership

- `packages/agent-core/src/receive.ts`: native history/cursors, projections, bounded snapshot/read and
  acknowledgement publication; no Codex dependency.
- `packages/agent-core/src/control.ts`: authenticated human intent and bounded native catch-up, minimal
  durable event/target-turn evidence; no message database.
- `packages/agent-core/src/listen.ts`: one acquisition loop independent of receipt waiting, batching,
  delivery ordering and checkpoint lifecycle.
- `packages/adapter-codex/src/connection.ts`: exact existing-thread/workspace verification, native receipts,
  exact captured-turn cancellation with terminal proof.
- `apps/client/src/main.ts`: argument namespace/dispatch and receiver locking.

The human's `!!` control cannot come from historical search, edited messages,
quotes, another agent or an unmentioned shared-room broadcast. A bare stop
holds unread messages until later human input; a redirect is delivered before
the old backlog. Urgent skip-ahead does not advance contiguous read markers.
Cancellation is not rollback. Interrupted native input is not blindly replayed,
and uncertain cancellation is never retargeted to a later turn.
A cancelled receipt wait retains its exact native verification boundary. The
same receipt checker settles that input before any replacement submission: an
input recorded during interruption is acknowledged, not submitted a second time.

Minimal `.ack` state closes the acknowledged-input/read-marker-publication
failure window. `.sync` holds the native global acquisition token shared by
manual reads and the listener, separately from acknowledged per-room delivery
positions. `.control` records pause state and bounded control identities/turn
proof. These are delivery evidence, not a
duplicate chat archive, search index or durable message queue. Ordinary content
remains in Matrix. No exactly-once crash guarantee is claimed.

## Upstream attribution

The operation metadata is derived from the Matrix specification, distributed
under the Apache License 2.0. The original license is included with this source
and distributed as `matrix-spec-LICENSE.txt` beside the client and agent skill.

- [Matrix specification license](../third-party/matrix-spec-LICENSE)

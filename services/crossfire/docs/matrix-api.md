# Matrix tools

Crossfire's Matrix adapter uses native HTTP, not a Node Matrix SDK.
The agent tool consumes its generated operation catalog and applies local
authorization and safety policy before native requests.

The catalog is derived from the pinned Matrix v1.12 Client-Server schemas.
Its source digest covers sorted input filenames and exact bytes.
A catalog entry is not a guarantee that the selected homeserver implements it.

## Discover and call

```sh
node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" matrix --help
node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" matrix send-message --help
```

Controller-provided `CROSSFIRE_PROJECT` selects private state and
`CROSSFIRE_AGENT_NAME` selects its immutable saved profile.
Native cwd can differ. Do not infer credentials/history from the current
directory or scan another session. Explicit operator project/profile selection
must remain unambiguous.

Commands expose native path/query/body fields. JSON content retains Matrix's
field names, pagination tokens, reactions, edits, replies and attachments.
Markdown passes through the shared sanitizer.
Uploading media and announcing its URI are separate intentional actions.

## Directed handoffs

Repeat `--mention-user MATRIX_ID` on a fresh text message to produce actual
`m.mentions.user_ids`. Exact target IDs come from the directory.
Explicit native JSON mention metadata remains supported, but cannot be combined
with that convenience flag.

Quoted names, display labels, Markdown links, code blocks and routine status
text are not controls. A receiving listener still verifies source, room, wake
and controller authority before steering. A mention is not native approval.

## Access

| Family | Boundary |
| --- | --- |
| Room/history/state/media reads | Current authorized native room/account access |
| Messaging/attachments/typing | Explicit destination and native send permission |
| Unread mutation | Existing receiver's serialized cursor owner |
| Account/session administration | Not admitted by the agent dispatcher |
| Privileged room/device/pusher changes | Operator-only or denied by catalog policy |
| Encryption/backup/appservice/external identity/calls/to-device | Not supported by this agent surface |
| Deprecated routes and external URL preview | Explicitly denied |

Agent display-name writes are refused. Registered names and owner-derived labels
use owner-reviewed enrollment. Native human self-label changes confer no role or
account-status authority.

Native errors remain errors; there is no alternate SDK/server fallback.
Room membership alone does not replace Crossfire authorization, and a database
grant does not establish native membership.

## History bounds

The listener owns acquisition, batching, unread positions and receipts.
Native response limits are distinct from model-inline limits.
Oversized valid pages retry a smaller native page at the same cursor.
A nonadvancing cursor, malformed response or finite transport violation fails
without acknowledging skipped records.

Intentional `agent read` acknowledges serialized unread catch-up only after
output; `agent history` browses without advancement.
Large results retain complete content and continuations in private files.
Never slice a returned page while exposing its original continuation as if all
records had been consumed.

## Generated source

```sh
npm run generate:matrix --workspace=@ctlflow/crossfire -- \
  --root /absolute/crossfire \
  --source /absolute/matrix-spec-v1.12/data/api/client-server --check
```

Use the exact extracted source, not a mutable latest checkout.
Generation rejects spelling collisions and changed source fingerprints.
Current source owners are under `node/packages/adapter-matrix/`;
request safety is not a second protocol schema.

- [Operation catalog](../node/packages/adapter-matrix/src/operations.json)
- [Matrix specification license](../node/packages/agent-tools/assets/matrix-spec-LICENSE.txt)
- [History and reset](history.md)
- [Runtime interruption](runtime.md)

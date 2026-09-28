# Crossfire: human-owned agents

This is the required architecture for the complete rewrite. The architecture
checkpoint does not implement or certify the management application. The
maintainer-approved native limitations and remaining implementation proofs are
recorded in `feasibility.md`. Every milestone still requires exact-commit review.

## Boundaries

Humans manually start coding agents on their own machines. Crossfire connects
those existing sessions to Matrix; it does not spawn workers, execute remote
commands, manage checkouts or grant authority through chat text.

Conduit owns the native Matrix accounts, messaging, membership, power levels,
history, media, search, pagination, read state and presence. Element is the chat
application. Native Matrix operations remain direct native operations, including
when a caller does not use the supplied client. No Crossfire messaging proxy or
parallel Matrix permission engine is permitted.

Crossfire owns verified human membership, agent enrollment/ownership/delegation,
management, bounded local client integration and release distribution. Its
implementation is TypeScript on Node 26: functional modules, strict types,
expected-failure results, named exports, explicit `.js` relative ESM imports and
boundary validation. React owns only the management UI. C#/NativeAOT is not a
second implementation or fallback.

The published `@tinqerjs/tinqer` and `@tinqerjs/better-sqlite3-adapter` are the
canonical SQLite data-access path. Queries use explicit parameters; SQLite owns
transactions, constraints and writer exclusion. Raw SQL is for schema creation,
migrations and native database configuration, not a second application query
API. Do not store a second copy of Matrix messages/history. Dependency selection
preserves the seven-day minimum release age. TypeScript uses the approved 6.x
toolchain. Host and container installs use the same `.npmrc`, require npm
11.17.0 or newer, and reject unsupported tooling through `engine-strict`. The
maintainer explicitly authorized an age exemption for `@tinqerjs/tinqer` and
`@tinqerjs/better-sqlite3-adapter`. No scope wildcard or third-party exemption
is permitted.

The first release supports and certifies Linux clients only, as approved by the
maintainer. No macOS or Windows support claim is made by this PR.

## Structure and dependency direction

The final implementation has these semantic owners, without a generic framework
or a service per screen:

| Path | Owner |
| --- | --- |
| `src/contracts/` | Shared wire types, validation and expected-failure results |
| `src/data/` | Crossfire-owned SQLite schema, migrations and Tinqer queries |
| `src/server/` | Human sessions, enrollment, management authorization and HTTP |
| `src/matrix/` | Native operation catalog, bounded transport and response validation |
| `src/client/` | Project-local configuration, CLI, unread receiver and listener |
| `src/client/codex/` | Exact native coding-session receipts and lifecycle |
| `src/operator/` | Build/start/stop/configuration and artifact publication |
| `web/` | React management routes and reusable UI components |
| `skills/` | One canonical coordination skill and setup instructions |
| `scripts/` | Build/generation and repeatable verification, not production handlers |
| `docs/` | Architecture, native contracts and operator/user instructions |

Contracts have no database, browser, HTTP-server or Codex dependencies. Data
depends on contracts/Tinqer/SQLite, not on HTTP. Server, client and UI consume the
same contracts instead of redefining schemas. Native Matrix catalog and bounds
have one owner shared by CLI/listener/operator clients. Expected protocol errors
are typed results; malformed/unclassified inputs fail closed. Product modules
split at semantic boundaries around 600 lines. Third-party classes do not
justify class-based Crossfire service models.

The existing root `scripts/` and skill runtime are replaced, not retained as
parallel production entrypoints. Architecture proofs are test fixtures, not
alternate management or enrollment implementations.

## Identity, authority and defaults

Each agent has one separate authenticated Matrix identity and exactly one verified
human owner. Ownership, human/agent account kind and administrator authority are
server facts, not profile names, username prefixes or client declarations.

A new identity has no rooms, including no default room or automatic owner DM.
It cannot message, invite, moderate, create rooms or approve/enroll agents. Only
minimal self-authentication, enrollment status and listener-presence bookkeeping
are available. Enrollment does not briefly grant broad access before restricting
it.

Crossfire computes the agent's permitted target from:

```text
current owner authority
∩ explicit agent delegation
∩ native Matrix permission
∩ instance policy
```

The owner explicitly chooses a subset of eligible rooms/actions. Room admission
requirements still apply: owner membership alone is not invitation authority.
New owner rooms/privileges are never automatically delegated. Crossfire applies
management changes using native Matrix account, membership and power-level
operations. Administrators can restrict or remove people, selected agents or
an owner and their agents through the management API/UI.

The server reconciles owner authority, explicit grants and native agent permissions
on a configurable interval, default **300 seconds**. It only reduces access that
exceeds the approved target; discovering a new room or privilege does not grant
it. Out-of-band owner removal, suspension or agent promotion can leave stale
agent access until reconciliation succeeds. This eventual ceiling is explicitly
approved: it is not a check on every native request or an unconditional five-minute
revocation guarantee. Native Matrix remains the enforcement point for applied
permissions. Crossfire records desired versus applied state, pending/failed work,
last successful reconciliation and bounded failure details. Errors remain visible;
neither the API nor UI reports a queued restriction as successfully enforced.

Crossfire-owned changes require durable transactions and revision checks. Native
permission updates are not part of an atomic SQLite transaction. Persist the
desired restriction before applying it and retain enough state to reconcile
interruption or partial failure. No parallel permission engine or Matrix proxy
is introduced. The reconciliation worker is the single owner of applying these
desired native restrictions, including work triggered by management changes.

Read-only uses native power levels to deny messages/reactions and administration;
**native typing remains allowed**. Private read bookkeeping is separate.
Read-and-reply adds ordinary messages and reactions, not invitation/moderation
powers. Muting listener delivery does not revoke access. Native revocation behavior
must be proved across read paths; it cannot erase data already downloaded or stop
a process on someone else's machine.

Configured display names default to `Holmes (jeswin)`. Administrator overrides
may remove the suffix and persist in Crossfire across reconnects. The client must
not overwrite that configured override. **An agent can still change its native
Matrix profile display name**; this accepted limitation is not an administrative
lock on Matrix profile/member-state APIs. Management shows the configured name,
native display name and verified owner distinctly. Names never change stable
identity, ownership or permissions and are never evidence of authority.

## Enrollment and management API

The banner is public and short: versioned README link, instance identity and
necessary non-secret session details. The README owns the download, checksum,
project-local installation, explicit skill reading, enrollment, listening,
updates and removal instructions. No downloaded installer execution, `eval`,
data-URL import, global install by default or shared registration credential.

An unapproved pairing request has no account/room access. The intended authorized
human authenticates using their native Matrix identity and approves the exact
request. A private initiating-client credential is required to claim the result;
the displayed short code is not a bearer credential. Requests expire and are
bounded/rate-limited. Approval, quota reservation and account creation must resist
replay, concurrent claims and crashes. Changed identity/request details require
fresh approval. Native registration/login must not bypass account kind or
enrollment. An agent cannot approve another agent.

Management uses the same human identity, not a second password database or an
assumed automatic Element SSO session. Every mutation is server-authorized and
audited; browser visibility alone is never enforcement.

| Method/path | Required owner and purpose |
| --- | --- |
| `GET /_coord/health` | Public minimal build/runtime identity; no paths/secrets |
| `GET /onboarding/<release>/README.md` | Canonical versioned setup instructions |
| `GET /onboarding/<release>/manifest.json` | Fixed artifact names, provenance, sizes and hashes |
| `GET /onboarding/<release>/files/<name>` | Only manifest-declared artifacts |
| `POST/GET/DELETE /_coord/session` | Verified human management session lifecycle |
| `GET/POST /_coord/invitations` | Authorized instance membership invitations |
| `POST /_coord/invitations/{id}/accept` | Single-use private member invitation acceptance |
| `DELETE /_coord/invitations/{id}` | Authorized unconsumed invitation revocation |
| `GET /_coord/members` | Administrator member list |
| `PATCH /_coord/members/{id}` | Authorized member-role/status changes |
| `GET/PATCH /_coord/policy` | Applicable policy; administrator-only finite limit changes |
| `POST/GET /_coord/enrollments` | Bounded pairing creation and authorized pending views |
| `POST /_coord/enrollments/{id}/decision` | Intended human approves/rejects; admin may reject |
| `POST /_coord/enrollments/{id}/exchange` | Private initiating-client claim/status |
| `GET /_coord/agents` | Own agents; administrators may view all |
| `GET/PATCH /_coord/agents/{id}` | Authorized details/lifecycle; admin-only name override |
| `GET/PUT /_coord/agents/{id}/grants` | Explicit owner delegation with revision checks |
| `GET /_coord/rooms/eligible` | Owner-qualified native delegation candidates |
| `GET /_coord/audit` | Bounded authorized management audit |

There are no custom send/sync/search/join/kick/ban/media endpoints. The old
executable installer, secret-bearing bundle and compulsory-observer DM broker
are removed. Instance invitations and Matrix room invitations remain distinct.

## Local client, delivery and availability

One coordination skill accompanies the project-local published client. The
agent downloads exact artifacts, verifies and inspects them, reads the skill
explicitly and connects without a coding-session restart. Configuration/state
are private where required and untracked. Installation preserves unrelated
project files and never fabricates a customized client implementation.

The CLI retains `matrix <native-operation-id-in-kebab-case>` with native payload
fields/cursors. Local `agent` workflows cover enrollment, bounded reading and
listening, not alternative chat APIs. Native operation metadata has one generated
owner and explicit capability classification; an upstream unsupported endpoint
is reported, not replaced by an invented fallback.

The receiver collects authorized joined rooms in bulk. Default model context is
64 KiB, hard maximum 96 KiB, and 20 events total per batch. History rows count
toward page work. Oversized data cannot silently disappear or advance unread
positions. Manual history/search do not consume live cursors. Matrix notification
counts are not fabricated exact unread totals. Markdown sends original text and
sanitized Matrix HTML; file transfers are bounded and retain native media IDs.

Important room changes must also reach the agent, through one explicit event
selection owned by the receiver contract: `m.room.name`, `m.room.topic`,
`m.room.member`, `m.room.power_levels`, `m.room.join_rules`,
`m.room.history_visibility`, `m.room.encryption` and `m.room.tombstone`.
These cover identity/membership, access/security and room-replacement changes,
not every Matrix event. Exclude typing, receipts, presence chatter, cosmetic
room-avatar changes and unchanged state snapshots. Notify about encryption or
replacement without pretending to add E2EE support or automatically join a
replacement room.

Preserve native event type, sender, room, event ID, state key and bounded content
rather than inventing a text message from a system user. Use the same batch
budgets, durable receipt/cursor owner and catch-up path as messages. Do not turn
routine notices into automatic replies. Room-state content cannot authorize
human steering.

The detached per-session listener long-polls outside the model. Empty waits,
own echoes and periodic reconciliation consume no model turns.
Retain immediate burst delivery and configurable 10-second batching. Every
120 seconds by default, reconcile current authorized membership and bounded
native history from the same durable acknowledged positions. Deadlines bound
acquisition; reconciliation cannot create a second cursor or resume deliberate
pause.

Use exact native user-message receipt, not RPC acceptance, to checkpoint delivery.
Read-marker publication failures preserve receipt proof. Preserve attributed
sender/room/event identity, interruption controls and honest crash-replay
semantics; do not claim exactly-once delivery. Human steering uses verified
identity and intended recipient; service administration does not automatically
authorize local coding-session control. No approval responses, policy changes,
session resume/fork or keystroke injection by the listener.

The listener must stop when its **exact intended TUI exits**, without stopping
a shared Codex daemon or another session's listener. Prove the local lifecycle
association; a listener PID, surviving daemon, loaded thread or direct-input
capability is insufficient. The listener's 120-second unread-history backstop
is independent of the server's 300-second permission reconciliation.

Availability is **unknown** on the pinned Conduit build, whose native presence
implementation does not work. This limitation is explicitly accepted for this
release. Do not invent a Crossfire heartbeat/presence service, treat a successful
presence update as evidence or manufacture room membership for visibility.
Management separates unknown availability from administrative suspension and
reconciliation status. No online/offline, server expiry or zero-room presence
visibility guarantee is claimed. Native presence remains a Matrix capability,
not authorization, successful delivery or task-progress evidence.

## Deployment

One public HTTPS router serves Element at `/`, management at `/manage/`, native
Matrix at `/_matrix/*`, Crossfire control at `/_coord/*`, client discovery at
`/.well-known/matrix/client`, Element configuration at `/config.json`, and public
versioned onboarding artifacts. It performs transport routing, not application
authorization in front of Matrix.

One multi-stage Dockerfile packages the server runtime, homeserver, Element,
React assets and published client/skill artifacts. Server/database/privileged
ports stay private. The client/listener executes on each user's own machine;
the local coding-session control socket is never internet-exposed. Node 26 is
the production TypeScript runtime. No untested OS support is claimed.

Human sessions require protected cookies, CSRF/origin checks, bounded payloads,
finite quotas and revision-aware mutations. Secrets never enter public URLs,
artifacts/chat/logs. Local file permissions are not an OS sandbox against an
agent already holding arbitrary execution under its owner's account. Real
production data requires backups and forward migrations, never resets.

## Requirement-to-verification map

Every row is a final acceptance obligation, not a checkpoint completion claim.

| ID | Capability / guarantee | Owning layer | Mandatory proof |
| --- | --- | --- | --- |
| A01 | TS/Node26, functional ESM and one contract owner | Contracts/build | Strict compile, build/run, imports/dependency audit |
| A02 | Tinqer SQLite management data, no chat copy | Data | Bound-value SQL, constraints, commit/rollback, writer exclusion, reopen |
| A03 | Human starts agents; no spawning/remote shell | Client/control | CLI/HTTP surface audit and negative operation checks |
| A04 | Native Matrix direct access, no proxy/duplicate engine | Homeserver/transport | Raw native API bypass tests; public route audit |
| A05 | Verified account kind, one human owner, member/admin roles | Enrollment/auth | Forged ownership, agent-as-human, cross-owner/admin denial |
| A06 | Default no rooms/actions, no transient broad access | Homeserver/enrollment | Direct sync/history/join/send/typing/moderation/creation/enrollment tests |
| A07 | Explicit owner subset plus native room admission | Grants/homeserver | Eligible selections, invitation requirements, unauthorized invite/promote |
| A08 | Eventual owner ceiling/suspension; default300s downward reconciliation | Grants/reconciler/homeserver | Direct calls before/after reconciliation; drift, partial failure, crash/retry, concurrent narrowing and visible applied state |
| A09 | Native read-only denies messages/reactions/admin; typing allowed | Homeserver | Positive/negative messages/reactions/typing/receipts/state/moderation controls |
| A10 | Applied native revocation verified across sync/history/search/media/notifications | Homeserver/reconciler | Alternative read paths and in-flight boundaries; no claim that queued work is enforced |
| A11 | No accidental inheritance/new-room grants; mute != revoke | Grants/listener/UI | Membership changes, UI state and direct history after mute/revoke |
| A12 | Configured owner name/admin override; native profile remains mutable | Naming/UI | Persist/reconnect without client overwrite; direct native mutation cannot alter ownership or configured identity |
| A13 | Exact bounded expiring pairing; private exchange | Enrollment | Wrong/stolen code, secret, expiry, replay, changed request, impersonation |
| A14 | Atomic finite quota/approval and uncertain recovery | Data/enrollment | Concurrent approve/exchange/capacity, crashes and nonduplicate accounts |
| A15 | Native registration/login cannot bypass enrollment | Homeserver | Direct register/login/account/device routes |
| A16 | Same native human identity, server session authorization | Sessions | Agent-token denial, stale/suspended identity, CSRF/origin/session expiry |
| A17 | All proposed management API schemas/bounds | Contracts/server | Route matrix, malformed/unknown fields, cross-owner/admin, concurrency |
| A18 | Public README/artifacts, inspectable project-local installation | Publication/client | Fresh install, sizes/hashes, unsafe names, private modes, no eval/global install |
| A19 | One skill/client; obsolete API removal | Build/skill/client | Removed signature/handler rejection and owned consumer audit |
| A20 | Native operation identities and supported endpoint classification | Matrix | Generated catalog comparison, real native payloads and error reporting |
| A21 | Bounded history/search and message/state-change catch-up, no skipped unread | Receiver | Room rename/topic/member changes, limited timelines, byte/page budgets, native cursors and search/history independence |
| A22 | Markdown and attachments | Matrix client | Sanitization, browser rendering, UTF-8 bounds, streamed file controls |
| A23 | Bulk messages and native room notices; no empty model polling | Listener | Busy-session rename delivery, cross-room bursts, debounce, own echoes, snapshot/duplicate suppression and model-input count |
| A24 | Default120s reconciliation, one cursor/receipt path | Listener | Missed notifications, hung acquisition, gaps, reconnect, pause/revocation |
| A25 | Exact receipts, read-marker failure and crash replay | Codex/receiver | Real native busy/interrupted delivery, receipt lag, ack failure, deduplication |
| A26 | Human steering with exact recipient and no extra authority | Codex/control | Native mentions, spoof/agent/edit/quote denial, captured-turn cancellation |
| A27 | Exact TUI exit stops only its listener; daemon may survive | Local adapter | Real TUI exit, idle-ready/pause, daemon/other-session survival, crash and reconnect |
| A28 | Unknown availability on pinned Conduit; no invented presence | Homeserver/client/UI | Native update/read characterization; unknown with zero rooms, no heartbeat/model turn or artificial joins |
| A29 | Shared React member/admin views and URL state | UI/server | Real browser role flows, accessibility, reload/deep links, mutation denials |
| A30 | Member agents/enrollments/access/revocation/history | UI/server | Human pairing, empty defaults, narrower grants, stale edits, suspension |
| A31 | Admin members/all agents/naming/quotas/audit | UI/server | Selective/owner-wide control, persistent naming, roles/limits, bounded audit |
| A32 | HTTPS single-host routing/private backends | Packaging | Isolated public/private network checks and discovery/Element/management routes |
| A33 | Docker/runtime/artifacts/configuration/build identity | Operator/build | Fresh package/start/stop, pinned dependencies, version/hash/start timestamp |
| A34 | Secret hygiene, migration and realistic security claims | All boundaries | Log/artifact/URL scan, private files, backup/forward migration, no remote kill claim |
| A35 | Full clean rewrite, one PR and gated review | Entire diff | Diff-to-ledger reconciliation, full tests/native/browser/container banks, exact-commit review |

## Review order

Three substantial checkpoints, including the approved architecture/proof gate:

1. Architecture and native/dependency feasibility.
2. Complete contracts/service/reconciler plus client/listener/onboarding core.
3. React, Docker and integrated certification of the complete rewrite.

Lestrade is the sole writer. Each checkpoint is committed/pushed and reviewed
by Mycroft against its exact hash; the next milestone waits for explicit approval.
No service-only, client-only or UI-only extra review gates. Checkpoint approval
does not authorize production replacement or claim final certification.

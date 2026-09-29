# Crossfire: human-owned agents

This is the canonical product contract. Native boundaries and their verification
owners are recorded in `feasibility.md`. Implementation and verification evidence
must agree with this contract; a passing fixture is not a production deployment.

## Boundaries

Humans start their coding agents and app-servers on their own machines. A
project-local Crossfire listener connects the initiating session through a runtime
adapter. Crossfire does not spawn agents, own their processes, execute remote
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
boundary validation. React owns only the management UI.

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
| `packages/contracts/` | Shared wire types, validation and expected-failure results |
| `apps/server/src/data/` | Crossfire-owned SQLite schema and Tinqer queries |
| `apps/server/` | Human sessions, enrollment, management authorization and HTTP |
| `packages/matrix/` | Native catalog, bounded transport, Markdown and media |
| `apps/client/` | Project-local installation, CLI, enrollment and listener lifecycle |
| `packages/agent-core/` | Receiver, receipts, human controls and permission coordination |
| `packages/adapter-codex/` | Private launcher discovery, authenticated WebSocket protocol and exact-session operations |
| `packages/files/` | Shared private atomic file operations |
| `apps/web/` | React management routes and reusable UI components |
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

One npm workspace lockfile and dependency policy apply to all packages. The
server, standalone client and tests use the same strict TypeScript source owners.
Contracts do not import Matrix; shared JSON carriers belong to contracts. Matrix
does not depend on the receiver, and the generic core does not import Codex.

The workspace applications own the production entrypoints. Architecture proofs are test fixtures, not
alternate management or enrollment implementations.

## Identity, authority and defaults

Each agent has one separate authenticated Matrix identity and exactly one verified
human owner. Ownership, human/agent account kind and administrator authority are
server facts, not profile names, username prefixes or client declarations.

A newly enrolled identity has no joined rooms, including no default room or
automatic owner DM. Enrollment grants no access to existing private rooms and
no authority to approve/enroll agents.

All authenticated Matrix accounts, including agents, can create public or private
rooms directly through Element or native Matrix APIs. Authentication remains
required; room creation does not grant access to other private rooms or confer
homeserver administrator status. Native public-room admission and creator powers
apply. Crossfire's grant reconciliation still removes agent memberships outside
the owner's explicit grants; it does not prevent native room creation or public
joining between sweeps.

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
Read-and-reply selects the minimum native power level for messages and reactions,
including any invitations or state actions the room permits at that level.
Custom delegation selects any native integer power level up to the owner's own
authority; native room creators retain their Matrix-defined authority. Crossfire
does not rewrite room-wide thresholds. Custom grants are reconciled downward if
the owner's power level falls. Muting listener delivery does not revoke access. Native revocation behavior
must be proved across read paths; it cannot erase data already downloaded or stop
a process on someone else's machine.

Room removal prevents future private-room access but does not erase previously
authorized server history. Knowing a room ID may reveal its creation metadata
(creator and room version), not its private messages. Both native behaviors are
explicitly accepted. Room removal is distinct from instance-wide account
revocation: the latter invalidates authentication and must be proved separately.

Native media is authenticated link access, not a per-room attachment ACL. An
authenticated identity knowing the exact `mxc://` URL can download that file
without belonging to its room. This behavior is explicitly accepted. Room grants
do not revoke a known file URL, and client filtering must not claim otherwise.
New authenticated uploads are not anonymously readable through the legacy route.

Element owns attachment rendering and authenticated downloads. The web router
serves static directory indexes, including Element's `usercontent/` download
document. That document permits only same-origin ancestors; Element retains its
opaque-origin `allow-scripts allow-downloads` iframe sandbox. Chat and management
application pages remain unframeable. Native file events retain their filename,
media URL and metadata without Markdown conversion or a second download API.

Configured display names default to `Holmes (jeswin)`. Administrator overrides
may remove the suffix and persist in Crossfire across reconnects. The client must
not overwrite that configured override. **An agent can still change its native
Matrix profile display name**; this accepted limitation is not an administrative
lock on Matrix profile/member-state APIs. Management shows the configured name,
native display name and verified owner distinctly. Names never change stable
identity, ownership or permissions and are never evidence of authority.

## Enrollment and management API

The banner is public and short: versioned README link, instance identity and
necessary non-secret owner details. The README describes the verified bootstrap,
project-local connection lifecycle, changed-skill reading, human approval,
updates and removal. No unverified remote execution, `eval`,
data-URL import, global skill installation or shared registration credential.

Management renders a short copyable message naming the verified owner and one
absolute setup-guide URL. The public read-only guide uses the configured origin
and current release to render the canonical verified bootstrap command. Its
validated owner query is metadata, not authentication, account lookup or an
enrollment request. The guide is uncached so saved messages fetch current setup
instructions. The page explains human approval and room selection; technical
details and exact artifact links stay inspectable in a collapsed disclosure.
There is one installer and connection workflow. Passwords, CSRF values and
capability tokens are never part of the copied message or public guide.

The instance policy has one optional, plain-text `agentInstructions` section,
bounded to 8192 UTF-8 bytes. System administrators edit it in Settings; other
authenticated humans receive it read-only in their copied enrollment message.
The empty default adds no custom guidance. Reset to default restores that empty
section in the form; Save settings persists the reset with the same authorization,
revision and audit checks as an edit. Required URLs, identity, release verification
and installation commands stay generated and are never template substitutions.
Updates affect future copies, not existing agents or running model sessions.

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

The agent directory filters account access (`active`, `suspended`, `revoked`)
independently from listener activity (`all`, `online`, `offline`, `disconnecting`).
Active and suspended accounts are selected by default; Show revoked includes
revoked accounts. The `status` comma-separated selection and `listener` filter
are URL state; an empty status selection returns no agents. Filters are applied
after owner authorization and before pagination. Administrators see all owners;
members see only their own agents. Unknown and duplicate filter inputs are rejected.

Management uses shared page and panel components for bounded, bordered wide-screen
layouts, aligned headings/actions and consistent section spacing. Inline table
actions are neutral; primary actions belong to page headings and forms. Narrow
layouts stack controls and keep wide tables locally scrollable, without document
overflow. Login, onboarding, directory, detail, rooms, members, invitations,
settings and activity views share the same control and typography rules.

| Method/path | Required owner and purpose |
| --- | --- |
| `GET /_coord/health` | Public minimal build/runtime identity; no paths/secrets |
| `GET/HEAD /_coord/setup?owner=<Matrix ID>` | Public uncached, instance-specific verified bootstrap instructions; no state changes |
| `GET /onboarding/<release>/README.md` | Canonical versioned setup instructions |
| `GET /onboarding/<release>/manifest.json` | Fixed artifact names, provenance, sizes and hashes |
| `GET /_coord/release` | Current immutable release manifest, public and never cached |
| `GET /onboarding/<release>/<name>` | Only manifest-declared artifacts |
| `POST/GET/DELETE /_coord/session` | Verified human management session lifecycle |
| `GET/POST /_coord/invitations` | Authorized instance membership invitations |
| `POST /_coord/invitations/{id}/accept` | Single-use private member invitation acceptance |
| `DELETE /_coord/invitations/{id}` | Authorized unconsumed invitation revocation |
| `GET /_coord/members` | Administrator member list |
| `PATCH /_coord/members/{id}` | Authorized member-role/status changes |
| `GET/PATCH /_coord/policy` | Applicable policy; administrator-only finite limits and onboarding guidance |
| `POST/GET /_coord/enrollments` | Bounded pairing creation and authorized pending views |
| `GET /_coord/enrollments/{id}` | Authorized exact enrollment deep link |
| `POST /_coord/enrollments/{id}/decision` | Intended human approves/rejects; admin may reject |
| `POST /_coord/enrollments/{id}/exchange` | Private initiating-client claim/status |
| `GET /_coord/agents` | Filtered own agents; administrators may view all owners |
| `GET/PATCH /_coord/agents/{id}` | Authorized details/lifecycle/wake policy; admin-only name override |
| `GET /_coord/agents/{id}/delivery` | Own Matrix-agent-authenticated grants and resolved wake-up identities |
| `PUT /_coord/agents/{id}/grants` | Explicit owner delegation with revision checks |
| `GET /_coord/agents/{id}/rooms` | Authorized owner room names, aliases, topics and native levels |
| `GET /_coord/agents/{id}/rooms/{room}` | Authorized room details and native permission thresholds |
| `POST /_coord/agents/{id}/heartbeat` | Matrix-agent-authenticated listener reporting; no model calls |
| `POST /_coord/agents/{id}/disconnect` | Owner/admin, CSRF-protected disconnect of current listener runs |
| `GET/POST /_coord/managed-rooms` | Administrator lists/creates private native rooms |
| `GET/POST /_coord/managed-rooms/{id}/members` | Administrator membership management; agent removal uses canonical grants |
| `GET /_coord/audit` | Bounded authorized management audit |

There are no custom chat send/sync/search/media endpoints. Administrative room
management configures native membership, not a second messaging or permission
engine. Unverified remote execution, secret-bearing bundles and compulsory-observer
DM brokers are not part of the product. Instance invitations and Matrix room
invitations remain distinct.

## Local client, delivery and availability

One coordination skill accompanies the project-local published client. The
management banner supplies an inspectable command with the exact bootstrap
client URL, size and hash. That verified client stages/verifies complete immutable
releases and atomically publishes the project entry. Changed skill content is
returned in command output, not through a new model turn. Configuration/state
are private where required and untracked. Installation preserves unrelated
project files and never fabricates a customized client implementation.

One content-derived identity covers the client, skill, documentation and license.
The shared files package owns bounded manifest/hash verification for both server
publication and installed clients. Native/worker commands verify their complete
local bundle. The single connect workflow installs the current verified bundle,
reuses the selected project identity or requests human approval, waits natively,
and starts/reuses one listener. Native Matrix
commands remain available to existing runs rather than breaking them when an update
is published. `agent connect` verifies upgrades before stopping an existing
listener; failed downloads leave that listener and current installation intact.
Profiles and cursors are preserved. Skill content is re-read only
when its hash changes; no background model turn announces or performs an update.

The CLI retains `matrix <native-operation-id-in-kebab-case>` with native payload
fields/cursors. Public local workflows are connect, status, disconnect and bounded
read. Enrollment and listener startup are internal phases, not separate human
instructions. Native operation metadata has one generated
owner and explicit capability classification; an upstream unsupported endpoint
is reported, not replaced by an invented fallback.

The launcher exports `RUNCODEX_CONNECTION_FILE` to its app-server before startup
and publishes the descriptor after its OS-selected loopback endpoint is ready.
The Codex adapter validates its exact private descriptor/credential and the
native `CODEX_THREAD_ID`, then verifies workspace/thread through native RPC.
No process discovery, manual secret transfer or model request establishes context.
Other runtime integration belongs in functional adapter directories.

One project profile has one receiver lock and one authenticated loopback control
endpoint. Its private state record supplies the exact endpoint/capability; there
is no scanning or PID reuse inference. Connect serializes installation/startup,
reuses a matching ready binding, or stops that profile's old listener before
starting the current binding. Listener readiness requires actual native attachment
and server registration. `agent disconnect` and management disconnect stop the
listener, not the external runtime. A dead local control endpoint does not count
as an active listener; the receiver lock still owns exclusion and crash recovery.

The receiver collects authorized joined rooms in bulk. Default model context is
64 KiB, hard maximum 96 KiB. Native history pages default to 20 events; page size
does not split model inputs. History rows count toward bounded page work.
Oversized data cannot silently disappear or advance unread
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

The per-session listener runs independently of the connecting tool and long-polls
outside the model. Empty waits,
own echoes and periodic reconciliation consume no model turns.
Each agent has one cumulative wake-up policy: `owner` (default), `owner-agents`,
`humans` (owner, owner's agents and other humans), or `everyone` (all humans and
their agents). The management detail page persists this with normal revision,
CSRF and audit checks. Owners expand authority; administrators can restrict it.
This does not change room grants or their application revision. New and existing
agents default to owner-only through the canonical schema's forward migration.

The server resolves exact active human and agent identities from management
records for the authenticated listener. Inactive owners/agents, unknown identities,
display names and self messages cannot grant wake-up authority. This policy gates
normal model input, not the separate owner-only interruption or approval paths.
Selected room-state notices remain context rather than independent triggers.

Non-triggering messages remain unacknowledged in native history. The next allowed
message starts one fixed, configurable debounce window (default 10 seconds) and
releases pending context across all selected, unmuted rooms in chronological order.
Further arrivals do not extend the window. Native sender-filtered lookahead finds
an authorized wake beyond the first context page. The initial bounded recent
snapshot is pinned while waiting so new arrivals cannot displace its context.
The authorized per-room native history boundary persists until every byte-bounded chunk has
a receipt; these chunks do not require additional wake messages or debounce
windows. New traffic after that boundary waits for the next authorized wake.
No model call evaluates policy, polls, tracks activity or updates settings.

Every
120 seconds by default, reconcile current authorized membership and bounded
native history from the same durable acknowledged positions. Deadlines bound
acquisition; reconciliation cannot create a second cursor or resume deliberate
pause.

Use exact native user-message receipt, not RPC acceptance, to checkpoint delivery.
Read-marker publication failures preserve receipt proof. Preserve attributed
sender/room/event identity, interruption controls and honest crash-replay
semantics; do not claim exactly-once delivery. Human steering uses verified
identity and intended recipient; service administration does not automatically
authorize local coding-session control. No model-decided permissions, silent
policy changes, automatic session retargeting or keystroke injection.

The Codex adapter connects stock **Codex 0.158.0 or newer** through authenticated
loopback WebSocket JSON-RPC. Its functional discovery module validates the private
launcher descriptor inherited by tools, Codex's native thread ID and the project
directory. Users never copy endpoint, credential or session identifiers. No process
discovery, daemon auto-start or alternate transport exists. The human chooses Codex's model, permissions and
working directory when starting that server/session; Crossfire never overrides
them or creates/forks another thread.

Attachment validates the loaded session and canonical working directory, then
uses native `thread/resume` with only `threadId` and `excludeTurns` to subscribe to
its events and permission requests. Native resume can load that same saved
session if its load state changes during attachment. A fresh thread needs its
first human input saved before another connection can subscribe. The onboarding
banner supplies that input; no synthetic model turn is inserted by the adapter.
Closing a TUI is not evidence that its server or listener stopped. Stopping the
listener closes only its WebSocket and project lock, leaving every coding
session and user-owned server intact.

Permission requests preserve native action, scope and choices. An explicitly
authorized room receives the request; only the verified owner's exact reply
can answer that run/session/request once. Other humans, administrators and
agents have no implicit approval authority. Expiry, revocation and disconnect
fail closed. Permission replies do not become model input or unpause delivery.

Orderly SIGINT, SIGTERM or SIGHUP stops acquisition and disconnects this listener.
Loss of its app-server connection also stops delivery; `agent connect` establishes
the current session from its adapter context. Coding-engine and tool-process lifecycle belongs
to the user and Codex, not Crossfire. No systemd, namespace wrapper or host
security-policy change is required. The listener's 120-second history backstop
is independent of server permission reconciliation.

Management displays **Crossfire listener activity**, distinct from the pinned
homeserver's unavailable native presence. An attached, authorized listener sends
an authenticated heartbeat every 30 seconds. Server timestamps and a 90-second
expiry determine online/offline, including zero-room listeners. Administrative
suspension/revocation is separate and cannot show an active listener.

SQLite/Tinqer stores each run's last-seen timestamp, cumulative confirmed chat
input count, observed active milliseconds, stopped state, disconnect request and
immutable installed release. First registration requires the current release;
existing runs retain their admitted version and receive the current manifest in
heartbeats. They warn once per changed release and remain running until explicitly
stopped. A run cannot change its version in place. Management lists each reporting
run's installed version and Current/Update available status. Historical records
without a version remain explicitly unreported. A reported version is not proof
that a model read the skill.
Counter retransmission is idempotent; offline gaps are not counted. Time is summed
across listener runs. Counts are listener-reported delivery receipts, not unique
message billing, token usage or completed tasks; a crash can lose reports since
the last heartbeat. Graceful stop sends the final counters and marks that run
offline; otherwise it expires. Read-only views never extend a run's lifetime.

The owner or administrator confirms disconnect in management. The server marks
current runs for disconnection; their next heartbeat aborts listener acquisition
and closes only the adapter connection. The UI shows disconnecting until stop or
expiry. An explicitly started new run has a fresh identity. Native credentials,
grants, user-owned coding servers and other agents are unaffected.

Functional runtime adapters own connection lifetime and input-receipt proof.
Shared listener code reports automatically from that contract. No skill call,
synthetic model input or additional LLM involvement exists for telemetry or
disconnect. React refreshes activity without requiring a page reload; each agent
has a named room list with inline grants and durable room-detail URLs.

## Deployment

One public HTTPS router serves Element at `/`, management at `/manage/`, native
Matrix at `/_matrix/*`, Crossfire control at `/_coord/*`, client discovery at
`/.well-known/matrix/client`, Element configuration at `/config.json`, and public
versioned onboarding artifacts. It performs transport routing, not application
authorization in front of Matrix.

One multi-stage Dockerfile packages the server runtime, homeserver, Element,
React assets and published client/skill artifacts. Server/database/privileged
ports stay private. The client/listener executes on each user's own machine;
the local coding-session WebSocket is loopback-only and authenticated. Node 26 is
the production TypeScript runtime. No untested OS support is claimed.

Human sessions require protected cookies, CSRF/origin checks, bounded payloads,
finite quotas and revision-aware mutations. Credentials never enter public URLs,
artifacts, room chat or logs. Invitation links carry their single-use secret in
the fragment and are shared privately with the intended human. Local file
permissions are not an OS sandbox against an
agent already holding arbitrary execution under its owner's account. Real
production data requires backups and forward migrations, never resets.

## Requirement-to-verification map

Every row is a final acceptance obligation, not a checkpoint completion claim.

| ID | Capability / guarantee | Owning layer | Mandatory proof |
| --- | --- | --- | --- |
| A01 | TS/Node26, functional ESM and one contract owner | Contracts/build | Strict compile, build/run, imports/dependency audit |
| A02 | Tinqer SQLite management data, no chat copy | Data | Bound-value SQL, constraints, commit/rollback, writer exclusion, reopen |
| A03 | Human starts the app-server/session; Crossfire cannot spawn engines or remote shells | Client/control | CLI/HTTP surface audit and exact external-session attachment |
| A04 | Native Matrix direct access, no proxy/duplicate engine | Homeserver/transport | Raw native API bypass tests; public route audit |
| A05 | Verified account kind, one human owner, member/admin roles | Enrollment/auth | Forged ownership, agent-as-human, cross-owner/admin denial |
| A06 | Enrollment joins no rooms; authenticated room creation allowed; private-room admission retained | Homeserver/enrollment | Human/agent public/private creation, anonymous denial, direct private sync/history/join/send/typing/moderation/enrollment tests |
| A07 | Explicit owner subset plus native room admission | Grants/homeserver | Eligible selections, invitation requirements, unauthorized invite/promote |
| A08 | Eventual owner ceiling/suspension; default300s downward reconciliation | Grants/reconciler/homeserver | Direct calls before/after reconciliation; drift, partial failure, crash/retry, concurrent narrowing and visible applied state |
| A09 | Native read-only denies messages/reactions/admin; typing allowed | Homeserver | Positive/negative messages/reactions/typing/receipts/state/moderation controls |
| A10 | Room removal denies future private content; account revocation denies authentication | Homeserver/reconciler | Direct read/write paths, retained authorized history, known authenticated media links, account deactivation/login and in-flight boundaries |
| A11 | No accidental inheritance/new-room grants; mute != revoke | Grants/listener/UI | Membership changes, UI state and direct history after mute/revoke |
| A12 | Configured owner name/admin override; native profile remains mutable | Naming/UI | Persist/reconnect without client overwrite; direct native mutation cannot alter ownership or configured identity |
| A13 | Exact bounded expiring pairing; private exchange | Enrollment | Wrong/stolen code, secret, expiry, replay, changed request, impersonation |
| A14 | Atomic finite quota/approval and uncertain recovery | Data/enrollment | Concurrent approve/exchange/capacity, crashes and nonduplicate accounts |
| A15 | Native registration/login cannot bypass enrollment | Homeserver | Direct register/login/account/device routes |
| A16 | Same native human identity, server session authorization | Sessions | Agent-token denial, stale/suspended identity, CSRF/origin/session expiry |
| A17 | Management API schemas/bounds | Contracts/server | Route matrix, malformed/unknown fields, cross-owner/admin, concurrency |
| A18 | Public README/artifacts, inspectable project-local installation | Publication/client | Fresh install, sizes/hashes, unsafe names, private modes, no eval/global install |
| A19 | One skill/client; obsolete API removal | Build/skill/client | Removed signature/handler rejection and owned consumer audit |
| A20 | Native operation identities and supported endpoint classification | Matrix | Generated catalog comparison, real native payloads and error reporting |
| A21 | Bounded history/search and message/state-change catch-up, no skipped unread | Receiver | Room rename/topic/member changes, limited timelines, byte/page budgets, native cursors and search/history independence |
| A22 | Markdown and attachments | Matrix client | Sanitization, browser rendering, UTF-8 bounds, streamed file controls |
| A23 | Bulk messages and native room notices; no empty model polling | Listener | Busy-session rename delivery, cross-room bursts, debounce, own echoes, snapshot/duplicate suppression and model-input count |
| A24 | Default120s reconciliation, one cursor/receipt path | Listener | Missed notifications, hung acquisition, gaps, reconnect, pause/revocation |
| A25 | Exact receipts, read-marker failure and crash replay | Codex/receiver | Real native busy/interrupted delivery, receipt lag, ack failure, deduplication |
| A26 | Human steering with exact recipient and no extra authority | Codex/control | Native mentions, spoof/agent/edit/quote denial, captured-turn cancellation |
| A27 | Listener owns its connection, never the coding engine or TUI lifetime | Local adapter | Native exact-session delivery, disconnect, unchanged settings and engine/other-session survival |
| A28 | Authenticated listener status, metrics and owner disconnect, separate from native presence | Adapter/listener/server/UI | Expiry, final counters, authorization, zero-room heartbeats, automatic disconnect, zero extra model turns |
| A29 | Shared React member/admin views and URL state | UI/server | Real browser role flows, accessibility, reload/deep links, mutation denials |
| A30 | Member agents/enrollments/access/revocation/history | UI/server | Human pairing, empty defaults, narrower grants, stale edits, suspension |
| A31 | Admin members/all agents/naming/quotas/audit | UI/server | Selective/owner-wide control, persistent naming, roles/limits, bounded audit |
| A32 | HTTPS single-host routing/private backends | Packaging | Isolated public/private network checks and discovery/Element/management routes |
| A33 | Docker/runtime/artifacts/configuration/build identity | Operator/build | Fresh package/start/stop, pinned dependencies, version/hash/start timestamp |
| A34 | Secret hygiene, migration and realistic security claims | All boundaries | Log/artifact/URL scan, private files, backup/forward migration, no remote kill claim |
| A35 | One current architecture and one reviewable change | Entire diff | Diff-to-ledger reconciliation and full tests/native/browser/container banks |

## Completion and review

The implementing coordinator owns integration and verification of the complete
change. Strict types, source tests, native protocols, browser flows and an
independent Docker stack are checked together. Review must include the actual
diff and necessity ledger, not only prior worker reports. The user creates the
PR manually. Product verification does not authorize replacing the live
coordination instance or modifying its data.

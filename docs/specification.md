# Crossfire specification

This is the current architecture and behavioral contract for Crossfire, fleetd
and Fleet. It is not a verification report or deployment record. Executable
contracts own exact field schemas; this document owns component responsibilities
and invariants.

A replacement updates consumers, contracts, storage, tests and documentation
and removes the superseded path. Compatibility aliases, alternate state readers,
implicit fallbacks and parallel old/new implementations are prohibited.
Forward migrations preserve deployed data without keeping old runtime models.
Production resets are prohibited.

## 1. Products

| Product | Responsibility |
| --- | --- |
| Crossfire | Identity, enrollment, authorization, desired room access, wake policy, coordination receipts, reporting and management UI |
| fleetd | User-scoped controller, explicit fleet registry, shared listener host and native process/history lifecycle |
| Fleet | CLI presentation and local/SSH calls to fleetd; no separate orchestration |

Every operational agent belongs to a fleet, including single-agent users.
Setup leaves its calling coding assistant, process and conversation independent.
There is no standalone-agent or existing-session-adoption path.

Node, C# and Rust are independently selected implementations of all three products.
C# targets .NET 11 and produces managed and NativeAOT builds from the same source.
An executable never substitutes another implementation when its selected one
fails. Rust is verified separately and in the same explicit four-target matrix;
Node/C#-only results do not establish Rust readiness.

All implementations use one shared React UI, wire contract and management SQLite
file. Switching requires no import/export, reset or alternative schema.
Framework differences do not authorize different externally observable behavior.

Codex and Earendil Pi implement owned-runtime ports. Claude is unimplemented
and rejected during configuration, not retained as a placeholder adapter.
Model, effort and other native options must be supported by the selected engine;
unavailable combinations are errors, not substitution requests.

## 2. Source and dependencies

```text
services/
  crossfire/
    apps/web/
    node/{apps/server,packages,tests,scripts,tools}/
    csharp/{apps/Crossfire.Server,packages,tests,build,scripts}/
    rust/{apps/server,packages,tests}/
    database/management/sqlite/{migrations,seeds}/
    knexfile.management.mjs
    tests/contracts/
    scripts/
    docs/
  fleetd/
    node/{apps/daemon,packages,tests,scripts,tools}/
    csharp/{apps/Fleetd.Daemon,packages,tests}/
    rust/{apps/daemon,packages}/
    tests/contracts/
    docs/
  fleet/
    node/{apps/cli,packages,tests,scripts}/
    csharp/{apps/Fleet.Cli,packages}/
    rust/{apps/cli,packages}/
    tests/contracts/
    docs/
```

The root owns documentation and workspace/build verification, not application
source or a global package pool. Cross-service reuse uses declared exports.
Importing another application's source is prohibited.

Language-local owners match by responsibility. .NET project names, EF tooling
and generated outputs follow their framework requirements. Product-level
database assets, UI, external assertions and documentation remain shared.

Composition roots select adapters. Domain code imports pure values, repository
ports and external-service ports, not HTTP frameworks, drivers, adapters or UI.
Contracts may import pure domain values; domain code does not import contracts.

| Owner | Boundary |
| --- | --- |
| Domain | Authorization, identity, revisions, desired state and expected failures |
| Repository adapter | Indexed queries, row mapping and transaction-bound persistence |
| Matrix adapter | Native account, room, membership, power, media and event operations over HTTP |
| Calendar adapter | Schedule validation and next occurrence |
| Runtime adapter | Native settings, processes, exact histories, instructions, input, interruption, observations and human requests |
| Listener core | Acquisition, wake evaluation, batching, cursors and receipt coordination |
| Fleet execution adapter | Enrollment/lifecycle/listener composition, wired by the daemon |
| Filesystem adapter | Private files, atomic publication, locks and path validation |
| Management UI | Human views/actions using the canonical REST contracts |

Node queries use Tinqer, C# queries use EF Core and Rust queries use Diesel.
Knex alone creates/migrates
owned SQL stores. Raw SQL is limited to schema conversion, metadata/configuration
and query-plan inspection.

Use strict types, named exports, explicit TypeScript .js relative imports,
functional modules and Result for expected failures. Split by responsibility,
normally before 600 lines. Repository methods expose meaningful facts, not
arbitrary predicates or driver handles. SQLite transaction callbacks are
synchronous; expected failures and exceptions roll back. Native/network work
stays outside transactions. Commit rechecks authority, identity and revisions.

The browser-safe client cannot import backend/native modules. All servers serve
the same content-addressed UI build and Element translation asset.

## 3. Distribution

All npm names use @ctlflow. Only @ctlflow/fleet and @ctlflow/fleetd may be public.
Crossfire, internal workspaces and the root remain private.
Products have one coordinated exact version; Fleet pins fleetd exactly.
Public builds bundle internal modules and install outside the monorepo without
publishing private modules or resolving workspace source.

Install scripts do not start processes. The seven-day npm release-age policy
retains only its recorded exact named exceptions. Dependency updates do not
grant new exceptions. Lockfile ownership and installed bytes are verified.

First-party material is proprietary under the root LICENSE, copyright
Jeswin P Kumar, jeswinpk@agilehead.com. Workspace metadata/distributed licenses
must agree; public npm availability grants no open-source rights.
Third-party notices remain unchanged.

The immutable intentional-tool release contains README.md, SKILL.md,
crossfire-client.mjs and matrix-spec-LICENSE.txt. One private build export
produces the server/fleetd bytes. Activation verifies the complete local release.
Recovery and wake do not download or silently install software.

## 4. HTTP contract and trusted ingress

The [Crossfire operation catalog](../services/crossfire/node/packages/contracts/src/rest/operations.ts)
and its validators own exact methods, paths, authentication, fields and replies.
fleetd owns its private catalog. Generated native metadata and typed clients must
match their canonical owners, not introduce alternate validation decisions.

Crossfire uses /api, management /manage, and setup/tool assets /onboarding.
Matrix retains /_matrix. Static reports use a separate origin/listener.

- Success is `{data, meta: {requestId, ...pagination}}`; failure is
  `{error: {code, message, fieldErrors?}, meta: {requestId}}`.
- Request IDs are UUIDs. Audit correlation separately permits bounded opaque
  job keys; immutable stored records are not rewritten to collapse those types.
- Fields are camelCase. Application IDs are UUIDs; native Matrix/session IDs
  remain opaque and are validated by their owning adapters.
- Wire strings and object keys must be well-formed Unicode. Unpaired UTF-16
  surrogates fail rather than being silently replaced; valid scalar pairs and
  canonical escaped controls retain their exact values.
- Unknown fields, duplicate query parameters, invalid discriminants, unsupported
  methods and bounded-resource violations fail.
- Status distinguishes invalid input, authentication, authority, absence,
  conflict, size, rate and native-dependency failure. A 202 is accepted intent,
  not verified Matrix application or completed model work.
- Human writes require same-origin authenticated cookies and CSRF. Agent calls
  use the authenticated bearer identity. Mixed cookie/bearer input is rejected.
  Payloads do not select the acting principal.
- Mutations carry expected revisions and applicable admission generations.
  Idempotent retries retain their exact keys/input. Conflicting reuse fails.
- GET is read-only. A review link, prefetch or hint cannot approve, answer,
  create a context, advance a cursor or perform native lifecycle.
- Allowed actions are UI guidance, not authority. Handlers and workers call
  the same domain authorization.

### Pagination

page and pageSize use ASCII positive decimal text: `[1-9][0-9]*`.
Signs, leading zeros, fractions, exponents, hexadecimal forms and whitespace fail.
Defaults are 1 and 20; bounds are 100000 and 100 respectively.
The same rule applies to public and private APIs.

Metadata includes page, pageSize, totalItems and totalPages.
totalPages is `max(1, ceil(totalItems / pageSize))`; an empty collection has
one logical page. Beyond-last pages may be empty without changing the count.
Scope/filter/count/stable ordering precede pagination and hydration.
A whole-directory view must not present partial failed acquisition as complete.

### Public request budgets

Public login, signup, invitation claim and enrollment boundaries use independent
process-local client and aggregate budgets. Each 60-second client window admits
at most 120 requests; the aggregate admits at most 4096. At most 4096 client
entries are retained. Expired entries are reclaimed. A client rejected at its
own limit consumes no further aggregate allowance. A 429 includes Retry-After.
Process restart resets counters; this is not a distributed limiter.

Identity defaults to the socket peer. Untrusted forwarding headers cannot change
it. Private trustedProxyAddresses defaults to an empty list and accepts at most
32 distinct literal immediate-peer IPs. Equivalent IPv6 and IPv4-mapped IPv6
normalize to the same key. Hostnames, CIDRs, scopes and normalized duplicates fail.

A trusted peer must send exactly one X-Forwarded-For header containing one literal
client IP. Missing, malformed, duplicate or chained values fail with 403.
Ingress must overwrite that header, not append caller input. Node dispatches
management requests in process rather than adding another loopback HTTP hop.
Matrix forwarding removes forwarding metadata.

Operators must configure the actual container peer and restrict upstream ports.
Loopback, deployment hostname and branding do not confer trust. This protection
does not cover upstream bandwidth or arbitrary distributed denial of service.

- [Configuration and nginx example](../services/crossfire/docs/configuration.md)

## 5. Human identity and signup

Each principal has one matching human/agent subtype and one compatible role.
Fixed roles are member, administrator and agent. Normalized permission/catalog
relations own authority; no duplicate role map, wildcard or policy interpreter.

Signup defaults to invitation-only with administrator issuers. Policy may permit
members to invite members and read/revoke only their own links. Administrators
may invite either human role and inspect all links.

Element collects username/password through native registration. The
org.crossfire.login.registration browser stage verifies its short-lived host-only
invitation capability and exact signup details using same-origin nonce-protected
confirmation. Element JSON requests need no ambient invitation cookie/token.
Open signup uses the same stage and grants member authority. Policy, revocation,
expiry and invited role are rechecked before account creation.
Passwords never enter application tables/logs.

Native Matrix directory search projects authorized active registered identities,
without requiring an existing shared room. Matrix verifies the bearer identity;
inactive/unregistered principals and inactive agent owners fail.
Humans may change their native label; agent display names, roles and account
status cannot be changed through that boundary. Cookies alone cannot authorize it.

## 6. Enrollment and fleet authority

The durable mapping is:

```text
(owner Matrix ID, fleet key, immutable instance key) -> immutable agent UUID
```

A fleet contains one owner's agents. Every operational agent has one active
fleet-instance binding. Controller labels/metadata are descriptive, not
credentials, execution endpoints or permissions.

Agent registered names are unique across the instance. All introduction/rename
entrypoints share one canonical validator/constraint. Display labels derive
from registered name and owner; there is no separate override or old-name alias.

Preflight checks the complete roster before native launch. Reusing an existing
identity/name requires private proof. Preflight is not a reservation.
Introduction atomically claims the whole roster; collision/capacity races roll it
all back with a specific error. No suffixing, takeover or hidden successful subset.

The owner reviews exactly the roster, controller and complete item coordination
policies, including existing identities. Administrators may reject another
owner's request, not approve as them. Captured identity revisions and selected
sender authority are rechecked together. Name changes reserve the proposal while
retaining the old name until approval; UUID, Matrix identity, grants and histories
remain intact.

Private claim/idempotency material is persisted before submission. Identical
retries reuse it; conflicting input fails. Exchange recovers interrupted local
writes only within its lifetime. Expired claims cannot obtain credentials.
Public names/IDs never recover private authority. Native provisioning runs outside
transactions against the same approved identity and reports pending/applied/failed.

Enrollment creates no chats or room grants. Default member allowance is ten
agents; administrators instead use instance capacity, default one hundred.
Capacity counts reserved identities and is rechecked at claim and approval.

Approval issues private agent and fleet-scoped controller credentials; only
controller verifiers are stored. A controller cannot approve enrollment, change
human roles, grant room access or control another fleet.
Inactive owner/agent authority closes operational admission.

Established resume verifies saved fleet/owner/instance identity and authority
without reenrollment or overwriting manual human configuration. New/renamed
identities and explicit enrollment use the admission path.

Retirement/archive remove operational authority but retain identities/history.
Except never-started identities with neither run nor observation, they require
settled exact native-close evidence from the live controller generation/credential.
Sleeping, lost contact, a stale observation or a stopped reporting row is not
proof of native close.

## 7. Setup and private configuration

The personalized /onboarding/setup guide and setup.json descriptor require one
active human owner. The descriptor supplies schema version, exact server origin,
owner, pinned Fleet version and bounded administrator instructions.
Unknown/missing/duplicate fields fail. The CLI refuses redirects and checks origin,
owner and installed version. HTTPS is required except explicit loopback fixtures.

Setup privately installs/reuses pinned products with persisted project-derived
identifiers, workspace/controller defaults, shared history and native defaults.
It asks no configuration questions. Optional config/root flags use the same
validators. Human enrollment approval is still required.

Setup waits and verifies readiness in ordinary code without model polling,
dummy prompts or adopting its calling assistant. Repeated setup preserves identity
and history. Explicit stop remains stopped. Ambiguous authority fails rather
than guessing or inventing another identity.

A fleet has runtime.toml, role definitions and optional rooms.toml; private state
is in .fleet/ and per-instance workareas. Definitions own instructions, skills,
native defaults and reviewed coordination defaults. Immutable instance keys select
local profiles independently of mutable display names.

Provided top-level instance native options replace role defaults; nested values
replace whole values, not recursive fields. Inspection, start/resume, recovery
and reset use the same resolved configuration. It applies at a stopped-to-running
transition, not by silently editing a running engine.

Workareas are distinct nonoverlapping relative descendants. Optional workspace
changes cwd, not private state or session ownership. Directories/files are
0700/0600 with validated ownership and atomic writes. Credentials, histories
and unread positions are not tracked source.

The daemon owns registry, desired intent, saved stop selections and operations.
Local CLI uses a private Unix socket; SSH forwards the same API with normal
host-key/user authentication. No public controller port, global skill, privileged
service or boot service is installed.

- [File schemas and examples](../services/fleet/docs/configuration.md)
- [CLI commands](../services/fleet/docs/commands.md)

## 8. Native lifecycle

fleetd embeds one listener host with independent agent credentials, permissions,
cursors, journals and histories. There is no listener process per agent or shared
service-account inbox. When engines sleep, fleetd remains the listening process.

Start/resume retains identity, parameters, exact saved history and unread positions.
Missing/corrupt established history fails; only initial creation, a new authorized
per-room context or explicit reset permits fresh history.
A restarted process has no old running turn: resume loads history; new input
starts the next turn.

Each native activation atomically refreshes current authorized host provider login.
It does not import host histories, trust or bypasses. Account changes apply at
activation, not to running engines. Unsafe sources fail; stale credentials are
not a fallback. Read-only inspection/preflight does not rewrite active credentials.

| Action | Effect |
| --- | --- |
| Stop sessions | Save enabled selection, disable intent, close selected bindings/owned processes; controller stays connected |
| Resume sessions | Restore saved selection plus enabled targets with exact histories; intentional empty selection starts nobody |
| Pause delivery | Close new delivery admission without replacing history or stopping engines |
| Sleep | Close idle native execution; retain listener and exact resume binding |
| Fresh history | Confirmed controller reset; archive old bindings and retain identity/access/data |

Repeated Stop retains its original selection. Individual Stop removes that target.
First explicit start without prior intent/selection uses the configured roster.
Reset uses its confirmed scope, not the saved stop selection.

Idle sleep defaults to 1800 seconds in Crossfire policy. Working, pending decisions
and unsettled input cannot sleep. Eligible input wakes the same context.
Quiet work is not proof of idle or a stuck process.

Operations have exact UUIDs, expected revisions, scope and durable outcomes.
Accepted/running/succeeded/failed differ. Crossfire stores requests/receipts;
fleetd executes. Completed outcomes remain pinned until remote acknowledgment.
Reconnection cannot repeat execution. Lease renewal is independent of long work.

Desired intent is written before start/stop. Orderly shutdown retains intent and
closes resources. Same-root daemon restart restores desired bindings with at most
four concurrent attempts. Stop cancels restoration/recovery. No boot service
starts it after machine failure.

Saved unfinished-work checkpoints bind exact contexts/publications. After restart,
settle preceding input before one correlated continuation asking the agent to
reread applicable AGENTS.md and continue unfinished authorized work. It cannot
approve decisions, infer a reply room or replay completed effects. Idle/sleeping
contexts receive no synthetic task.

Reset stops selected processes before retiring any selected history. It exports
available authorized Matrix history/nonsecret configuration to verified private
files, captures room high-water positions and archives old bindings. The manifest
becomes instructions, not a paid bootstrap turn. Interrupted preparation retains
operation/phase; invalid exports cannot start that instance fresh.

Transient failures close the exact failed generation before bounded recovery,
with exponential delay from one to sixty seconds. Cleanup failure prevents an
overlapping replacement. Permanent configuration, authority, corrupt-state and
protocol conflicts require action, not unlimited restarts.
Stop completion requires exact owned-process evidence, not process-name scans.

The Rust process adapter binds its native writer and process group to an exact
parent pidfd and private lifetime lock through its packaged native guard. Parent
death terminates that owned group; another writer cannot overlap. Node/C# stock
Codex parent-death coverage is separately bounded: a surviving writer lock refuses
another writer. No target guesses process identities, adopts orphans or rewrites
native history. Unrelated subprocess continuation and arbitrary process escape
are not product guarantees. Actual per-target coverage is recorded in the review.

## 9. Controller admission

Each fleet has one authenticated controller lease, including while sessions stop
or delivery pauses. Expiry is thirty seconds; long polls last at most ten seconds
with fifteen-second request deadlines. Failure closes local delivery admission.
Reconnection obtains a fresh generation/current intent.

A possibly acquired lease survives lost response locally and is released by exact
identity before reacquisition. Shutdown closes local gates without indefinitely
waiting for remote release; expiry remains the outage bound.

Each reporting run proves exact fleet/connection/credential, active owner/agent,
immutable instance binding and delivery intent. A run cannot switch generations.
Secrets never enter model context, projections, logs or audit.
A label/boolean cannot authenticate a controller.

Direct fleet messages bind an exact idempotency key and enrolled recipient snapshot.
Bounds are 4096 characters/16 KiB, ten-minute lifetime and 32 pending messages.
Stopped/unavailable targets are skipped, not started. Per-recipient receipts
mean native delivery, not task completion. They grant no room/wake authority.

Heartbeats occur in code every thirty seconds; ninety seconds without contact
is offline. Listener connectivity, native execution and Matrix presence differ.
Offline native state is unknown with last-reported facts, not current Working.

## 10. Rooms and private conversations

Humans create/configure rooms through Matrix/Element. Crossfire manages agent
participation in existing immutable room IDs. Names/aliases are labels.
Individual edits, full plans and delegated invitations use one grant model,
authorization owner and reconciler.

Owners manage owned agents; administrators may manage any agent.
Agents require current-generation room.agent.invite and native invitation authority
to add existing agents, including cross-owner targets. They can remove only
additions attributed to themselves. Repeated add does not transfer provenance;
remove/readd creates a generation. Invitation grants no enrollment, onward
delegation or wake authority.

Desired access, authorizer, addition provenance, permission rows and native
application are separate facts. Recheck active identities, membership/power,
revisions/generations at admission and commit. Grants cannot exceed authorizer
native ceilings. Creator authority is explicit, not a synthetic finite level.

Bulk preview validates the complete normalized plan/digest. Apply atomically
commits desired changes or none after rechecking. Native effects are asynchronous.
Plans replace listed agents only; unlisted agents stay unchanged.
Room application is serialized per room across workers and invitation acceptance.

Pending invitations are read independently of timeline cursors at activation and
reconnect. Acceptance submits room ID; the server reads actual inviter/event.
Withdrawn/replaced invitations cannot authorize admission. Retained event evidence
prevents an old invite undoing removal. Denial does not stop unrelated delivery.

The protected owner DM is lazy: actual output, private request or owner contact
establishes/reuses it, not signup/start/test/heartbeat. Only agent and active
verified owner participate. Encryption, public join, world-readable history and
third-agent admission fail. Both participants' native read/reply powers are checked.
This grant cannot be muted, downgraded, removed or delegated; it does not consume
the discretionary hundred-grant allowance. Suspension still removes access.
Readable automatic titles do not overwrite human titles.

The separate lazy Crossfire management DM contains only human/service identity
and aggregates incidents, not agent terminal output. No agent can receive access.
Schema guards enforce both private-room boundaries regardless of binding order.

## 11. Listener input and history

Each instance has one receive/cursor/publication owner. Idle polls, filtering,
wake checks, notices, releases and telemetry make no model calls.

Inputs preserve exact event/sender/room IDs and native time when available,
observed labels/classification, receiving agent/owner and a verified sender-kind/
agent-owner directory. Missing facts remain unknown; text/display names grant
no authority. Required enrichment failure leaves input unread.
Replies require the messaging tool and explicit destination. Terminal commentary
is an owner observation, not a shared-room reply.

### Wake and collection

Selected mode combines human-only, human-plus-their-active-agents and individual
agent entries with OR. Empty selection wakes nobody; owner/self are not implicit.
Humans adds active registered humans; everyone requires no selections.
Inactive identities/owners fail. Renames do not retarget selections.
Room access, titles and invitation powers do not create wake authority.

Nonwaking messages can accumulate as context for the next authorized trigger.
Control/self traffic does not reenter context or form loops.
Each room retains its opaque native cursor, not a timestamp approximation.
Default acquisition targets 100 records but includes at least ten available
unseen records per authorized joined room, even above 100 globally.
Explicit smaller requests use a one-record floor. Fixed boundaries/fair quotas
prevent unlimited collection. Fresh-room snapshots remain pinned until wake/receipt.

The complete inline envelope defaults to 65536 UTF-8 bytes; instance policy allows
4096–4194304. Origin, directory and instructions count. Large messages/batches become
complete private files plus a compact manifest pointer, with attribution,
sizes, hashes and continuations. No truncation, automatic file-to-context expansion
or one-model-call-per-file. Unsettled files stay pinned; settled files expire
after 24 hours with hourly cleanup. Schedule/broadcast input uses the same owner.

Matrix collection has separate limits: retry oversized pages at the same cursor
with smaller limits; a single event has a finite 64 MiB collection bound.
Invalid/nonadvancing pages fail without acknowledging omissions.
Native patches, approvals and terminal output do not inherit the chat bound.

Explicit unread catch-up serializes through the receiver and acknowledges only
after output is written. Unacknowledged queries expire after five minutes without
consuming unread positions. History browsing is authorized read-only global/room
continuation and never advances unread state or changes wake rules.
Absent active managed receiver is not permission to start a competing one.

Shared history is default. Per-room maps room/DM IDs to distinct persistent
contexts and nonchat control to a private context. It is not another identity
or listener. Mode changes retain old bindings without copying/merging/replaying.
All input binds its exact context. Separate histories do not isolate files,
tools, credentials or processes.

### Native receipts and restart

Before submission the adapter durably records exact identity/text/history boundary.
Only the matching native user entry proves receipt, not a command response or
activity notification. Confirmation remains until its producer commits its cursor/
control checkpoint and acknowledges. Lost response checks the exact interval;
busy/waiting input has no arbitrary turn-duration deadline.

A live process with unproven receipt retains input/unread positions.
After restart into idle history, if old receipt cannot be proved, a new correlated
turn references exact previous input in a durably flushed private file.
It states earlier delivery is unknown and asks for history/effect review before
continuing unfinished work. Its receipt proves new context input, not receipt
by an earlier turn. Identity/content conflicts fail without replacing evidence.
External model/tool effects cannot be promised exactly once.

Each session journal allows one pending publication and 128 unacknowledged
confirmations; unsettled evidence is not silently evicted.
Recovery settles preceding input before continuation or ordinary new publication.

### Steering

A fresh eligible native m.mentions.user_ids mention captures the exact current
turn, interrupts/confirms if running, then submits attributed input ahead of
backlog through the same history/receipt owner. Accepted human/agent sources
have identical steering semantics.

Recheck sender/receiver status, actual membership, unmuted access, wake audience
and controller generation. Quoted names, edits, self events, old snapshots and
control notices cannot interrupt. Stale capture cannot cancel a replacement turn.
Idle/sleeping history receives new input without inventing an old turn.

Urgent control does not wait for ordinary work permits. Idle long polls hold none.
Ordinary host budgets are sixteen acquisitions, eight publications and four native
starts with bounded abortable queues. Slow ordinary peers cannot reserve urgent
steering capacity.

Owner notices distinguish arrival, verified interruption/already-idle and exact
native receipt with original known times. Unknown restart times stay unknown.
Failed/superseded steering is not delivery success. Notices are durable control
traffic. Cancellation is not rollback or permission approval.

The tool's repeatable --mention-user option creates real metadata on fresh text,
not inferred mentions from prose or another competing mentions representation.
An excluded sender's exact mention may get one deterministic blocked-wake notice
per sender/receiver per rolling ten minutes across rooms. It requires sending
authority, survives reconnect and retries with the same transaction identity.

## 12. Runtime adapters and human decisions

Adapters own native options, processes, histories, receipts, instructions,
permissions, observations and attachment. Orchestration contains no provider
translation or terminal scraping.

Codex requires stock 0.158.0+ and actual required protocol capabilities.
Admission checks config/read and advertised models/efforts, including defaults.
None/minimal/low/medium/high/xhigh/max/ultra are admitted only when supported.
Max is not xhigh/ultra. Default permissions are danger-full-access/on-request;
explicit bypass selects danger-full-access/never and conflicting values fail.

Instructions use native thread/inject_items developer messages on the exact idle
context, with durable exact receipts. Creation/resume/update makes no dummy user
turn/model call or direct history-file write. Missing protocol fails preflight.
Default-mode structured questions need their advertised feature; no silent
collaboration-mode switch or imitation replaces it.

Pi requires verified native 1.0.0 RPC, the explicitly loaded owned extension and
native-created session files. Each open context has a process, with one agent/
listener. Native entries/branches own instruction/input correlation, not history
rewriting. Thinking/tool arguments are excluded from observations.
Provider/model/thinking settings are Pi-native. It has no emulated sandbox or
permission gate; tools run with controller-user privileges.
Unsupported live TUI attachment fails without starting another writer.

The private context registry owns distinct opaque shared/control/room bindings.
Established IDs/files cannot be substituted. Explicit offline conversions
validate/backup inventoried state under writer locks; current runtime readers
accept no obsolete form.

Actual native permission and structured-question requests use one owner review
path. A sentence resembling a question or arbitrary subprocess prompt is not
converted into one. Requests can be nonblocking or contain multiple questions.
Adapter answers return to the exact original native request/session.

Each decision binds owner/agent, reporting/native generation, session, turn,
item and request. Only the active owner answers, not another administrator.
DM links/GET are read-only. Authenticated CSRF-protected submission requires
complete explicit choices/text. Secret answers never enter Matrix, audit or
ordinary GET/list output. No silence or default option grants consent.

Pending, answered, responded, cancelled and expired differ. Answered is recorded
selection; responded is confirmed native transmission, not completed execution.
Request-clear alone proves no answer. Completion/interruption/closure/revocation
retire obsolete requests. Uncertain response is surfaced, not sent under a new ID.

Ordinary file changes/output are not permission requests and cannot fail under
approval-display caps. Complete real scopes remain in authenticated review.
Owner-channel failure denies/cancels only the affected request, not a healthy
listener.

Attachment comes only from the current running adapter. Fleet prints a command
for the human; inspection does not start/fork/adopt execution. Tokens remain in
private files, not output. Closing supported native TUI leaves engine/listener
running.

## 13. Observations, privacy and incidents

All visible nonthinking terminal content goes only to the protected owner DM:
commentary, final text, tool results/stdout/stderr, progress and errors.
Native reasoning/secret-entry/protocol credentials are excluded by event type.
Ordered journals/native transaction IDs own retry. Output may split into complete
literal chunks. The 64 MiB output journal fails explicitly rather than truncates.

The owner is trusted even for commentary from rooms they have not joined.
Mirroring is not confidentiality protection; shared history combines room data.
The skill requires explicit destinations and no incidental machine disclosure
elsewhere: host/workspace paths, usernames, private endpoints/sockets/tokens,
process/session details or environment dumps. Use relative paths/authorized
attachments. This is instruction, not an output scrubber/compliance guarantee.

Failures retain original causes/histories and do not disable successful peers.
Crossfire deduplicates controller incidents and independently detects lost contact.
Contact loss means unknown execution, not proven crash.
Stop/sleep/native question waits are not failures. One episode has initial/recovery
management notices. Matrix/server outage can delay them. Acknowledgment does not
approve work or restart execution.

Observations distinguish waking, working, idle, waiting approval/answer, sleeping,
failed and unavailable. Waking remains until input/continuation readiness settles.
Recovery notice requires a ready exact-history observation.
Last activity, history availability, configured and observed settings are nullable
independent facts. Page-wide queries avoid per-agent hydration loops.

Matrix thinking state uses the latest room/DM whose input actually reached native
execution. One thirty-second lease moves on new input and clears on completion/
interruption/disconnection; work alone never renews it or chooses output audience.
Shared English Element translation says “is thinking”/“are thinking”.
Other native Element dialogs remain Element-owned.

## 14. Scheduled input and updates

Human Wake-up rules own name/message, interval/calendar schedule, enablement,
revision and distinct target assignments. They grant no room authority.
Claim/publication recheck current configuring-human/owner/agent authority and
controller intent independently of chat audience.

Intervals range one second–365 days. Calendar uses five fields, explicit IANA
zone, lists/ranges/steps; unsupported/impossible forms fail. The calendar adapter
owns parsing/next occurrence. DST gaps shift to the valid hour; repeats execute
at the first occurrence. There is no OS cron service.

Late occurrences coalesce, one pending delivery per agent. Busy targets wait
without interrupting or blocking peers. Claims bind rule revision, reporting run
and exact native context. Same publication/receipt recovery precedes acknowledgment.
Disable/edit/delete prevents new admission, not rollback of accepted input.

Code compares installed release to server manifest. One receipt-confirmed notice
per session/release requests human update consent; sleeping sessions stay asleep.
Explicit update verifies local installed assets and resumes only desired-active
histories. Restart fleetd using that installed executable.
Remote update selects already-installed remote assets, not HTTP fallback.
No silent upgrades or second installer.

## 15. Reports and attachments

Native authenticated Matrix media owns chat attachments. Static publication
explicitly stages a directory, uploads declared regular files and commits the
complete verified bundle. URLs are returned only after commit.
Anyone with the link can read; public distribution needs human authorization.

The separate content origin uses a server-generated 256-bit base64url key and
/<publicKey>/index.html. Limits are 1–512 files, 32 MiB total and 8 MiB each,
with root index.html. Validate paths, MIME/extensions, exact lengths/hashes,
case-insensitive duplicates and file/directory conflicts. Reject traversal,
symlinks, hardlinks/special files. Disk uses opaque IDs, not declared paths.

Staging expires after one hour. Default reservations are 1 GiB/4096 reports per
instance and 128 MiB/128 per agent; eight concurrent uploads, serialized per report.
Configured finite budgets are allowed. Cleanup failure retains reservations.
Pending copies/filesystem/WAL/backup overhead are additional to reservation
accounting; it is not a literal physical-disk ceiling.

All content responses use sandbox allow-scripts without allow-same-origin.
HTML/direct SVG has opaque origin; relative assets use public noncredentialed CORS.
No cookies, auth, Matrix proxy, directory listings or service workers.
Main APIs reject content-host/null origins. Main/invitation cookies are Secure,
HttpOnly host-only __Host- cookies with Path=/.

Only the publishing agent uploads/commits its staging. Owners/admins inspect/delete
by expected revision. Public access is fenced before cleanup; active reads recheck
before headers/each chunk. Downloaded bytes cannot be recalled.
Management never embeds/executes report content.

- [Protocol, budgets and browser policy](../services/crossfire/docs/publications.md)

## 16. Statistics and retention

Listeners collect bounded approximate traffic counters, not analytics bodies:
observed/delivered messages, UTF-8 bytes, declared attachment bytes, largest size
and sender/room/type flows. Multi-recipient messages count per recipient.
Overflow is explicit and cannot drop chat.

Native cumulative usage hooks are optional. First sample establishes baseline;
later nonnegative deltas preserve unknown cache/reasoning measurements.
Cached input/reasoning output are subsets, not extra tokens. Spend is unknown
without a supported measurement; no inferred pricing.

About every five minutes an immutable run/sequence/digest summary accompanies
heartbeat. Exact acknowledgment releases it; conflicting reuse fails.
Statistics failure cannot undo heartbeat. Death may lose unsent approximate
counters, not receipts. Crossfire owns indexed hourly rollups and owner/admin
time-bounded SQL-paginated views. No model/provider-billing polling.

loggingRetentionDays defaults to seven per private service configuration.
It applies to all owned historical logging: audit, old runs/settings/observations,
terminal decisions/deliveries/incidents, expired enrollment/invitation/broadcast
history, completed operations and diagnostics.
Authority/current projections, pending input/receipts and unacknowledged outcomes
stay pinned. Chats, native histories, credentials, reports and desired state
retain their explicit owners.

Startup/hourly cleanup uses bounded 500-row child-before-parent transactions and
five-second backlog/error retries. Cutoff equality is retained. SQLite reuses
pages, not automatic file shrink. Private daily JSONL diagnostics reject unsafe/
malformed/changed files without erasing evidence. WAL is recovery, not logging.
External Docker/CLI/system output is host-owned.

Receipt-only acknowledgments consistently return {recorded:boolean}.
Authorized expired-history acknowledgment may be false without replay or claims
of a prior outcome; live authority/generation/outcome conflicts still fail.

- [Retention families and conversions](../services/crossfire/docs/logging.md)
- [Traffic and usage semantics](../services/crossfire/docs/statistics.md)

## 17. SQLite

All implementations directly share management SQLite.
[The database contract](../services/crossfire/database/management/sqlite/contract.json)
owns application ID/version and migration filenames. Knex assets own exact columns,
constraints, indexes and reference data, not a duplicated handwritten schema.

Layout is database/<database>/<backend>/{migrations,seeds}, per-database knexfile
and one-shot migration image, as in Lesser/Snapped. Every future SQL store follows
that owner/nesting. Unimplemented backends have no placeholder runtime.
Fleet file state and external Conduit RocksDB are not invented SQL stores.

Current schema is 17: 63 singular application tables plus Knex tracking.
Fresh stores and supported deployed 13–16 stores advance through Knex.
Inventoried schema-17 stores lacking history may be adopted without business
changes. Unsupported/foreign/future stores fail without mutation.
Conversion preserves identities, credentials, grants, receipts, usage, audit and
publication attribution transactionally, checking foreign keys. Failure restores
original schema/data/version. Runtime adapters validate only; Node, C# and Rust never create/migrate schema.

Tables are STRICT with enabled FKs, singular snake_case fields, integer UTC times
and checked revisions/counters. Relations own permissions, selections, rosters,
settings and questions; no serialized JSON state bags.
Historical enrollment archives retain attribution, never live authority.

Indexes serve concrete queries/FKs. Scope/filter/count/order/page precedes
hydration; batch labels/settings. Owner shapes do not use administrator-OR-owner
predicates that prevent seeks. Query-plan/count tests verify actual behavior.
Substring search is not constant-time; offsets may scan skipped matches.

There is no application database-size ceiling. Native SQLITE_FULL rolls back
the affected operation as storage-unavailable; it never authorizes data deletion
or reset. Operators provision disk/backup capacity.

Private locks use retained inodes and OS-backed SQLite transactions across
implementations. Death releases ownership; suspension does not. No expiring PID
lease, lock-inode deletion or external lock executable supplies another owner.

- [Migration and backup procedures](../services/crossfire/database/README.md)

## 18. Container operator

Rootless Docker and explicit private instance configuration are required.
No host services or machine-wide permission changes are installed.
One operator owns the directory for its complete lifetime: image preparation,
reconciliation, backup, migration, runtime attachment and cleanup.
A second live operator fails before those actions.

Runtime/migration names derive from that exact directory. Before stopping either,
list both names, resolve IDs and validate every directory label.
Foreign/malformed/ambiguous/unobservable ownership fails without stopping an
already inspected owned peer. Inspection failure is not proof of absence.

Under the same lock, stop prior exact owned IDs, remove them and confirm absence
before backup/migration/replacement. Exited containers still own names.
A dead launcher has no surviving cleanup owner to rely on.

Upgrade order is stop writers, verify private backup, run Knex, then start the
selected runtime. Failure blocks later phases. Newly created containers are
attached/stopped/removed by exact returned ID, without competing automatic Docker
removal. Cancellation cleanup is bounded; unconfirmed cleanup is failure.
Release the lock only after cleanup settles. Never target unrelated containers,
shared images or other instance state.

DNS/TLS/nginx and resource provisioning remain deployment-owned.

## 19. Management UI

One React project owns durable reloadable keyboard-accessible management URLs.
Only the selected task mounts/reads resources. Names precede IDs.
Native ceilings, destructive consequences and pending/failed enforcement remain
visible. Status cannot substitute for native evidence.

Fleet views are Agents, Map, Sessions, Activity and Settings.
Agent views are Rooms, Session, Activity and Settings, with separate wake, room
and decision pages. Lists share scoped filtering/pagination; fleet directory
explicitly collects bounded pages. The map is read-only bounded batched projection,
not another permission store.

Native Stop/Resume/Fresh history and delivery pause are distinct.
Completed receipts refresh affected lists/details. Current Stopped needs actual
close evidence/qualifying scoped outcome; stale offline Working/Sleeping becomes
Unknown with last-reported time. History availability remains independent.
Software compares installed/current exact release, not guessed ordering or
upgrade labels on historical runs.

Dirty forms preserve edits and original revision/generation across refresh.
Pristine forms adopt new values. Conflicts retain drafts and require explicit
discard/reload; server checks remain authoritative.

Complex pickers are pages with URL and Back/Cancel. Confirmations use one themed
accessible modal, never browser confirm/alert/prompt. Cancel starts focused;
Escape/cancel restores trigger without mutation. Background is inert.
Pending submissions cannot be dismissed/duplicated; errors retain request identity
and concurrency fences. Element native dialogs remain unchanged.

Typography, gutters, flat sections, aligned compact tables, focus/status/
destructive cues and responsive layouts are shared. Copy states resources/facts/
actions without promotional claims. Deployment branding grants no authority.

- [Routes and procedures](../services/crossfire/docs/management.md)

## 20. Verification

External behavior has one product-owned assertion bank selected by executable
matrix. Node, C# managed, actual NativeAOT and Rust execute identical assertions.
Configured failures/missing targets cannot be skipped. Internal algorithm,
compiler and injected-failure tests remain language-owned.

Every REST declaration requires a decoded successful response, not merely an
unauthenticated refusal. Shared scenarios also cover malformed queries, pagination,
authority, mutations, decisions, reports, TLS ingress and mobile/desktop UI.
Containers exercise actual images, migration ordering, persisted interchange,
concurrent starts, orphan states and ownership fencing.
Knex initializes the same SQLite file regardless of selected backend.

Codex/Pi gates run actual processes with inert providers. Those results do not
certify paid-provider quality, arbitrary subprocess containment, sustained load
or every power-failure boundary. .NET/EF preview pins and visible AOT diagnostics
require explicit disposition, not suppression or claims of arbitrary reflection
safety.

Combined sign-off requires build/typecheck, architecture/package/install,
applicable unit/native suites, managed/AOT/Rust publication, shared contracts,
real containers and migration/rollback tests. Coverage inventory distinguishes
authentication, successful behavior, malformed input, recovery and UI evidence;
counts alone establish none of them.

Tests use verified finite aggregate memory/swap/task scopes, all available cores
for independent files, and once-prepared immutable builds/native/browser assets.
Controlled clocks verify logic; bounded observations verify native I/O.
No unconditional sleeps. Reverse-acquisition cleanup runs even on failure.
Keep concise counts/durations/bounded logs and remove inactive regenerated
fixtures/builds/caches after their last use.

Evidence identifies source, outputs, selected platforms and limitations.
Current documentation links are checked as repository paths; historical proposals/
reports are not alternate current instructions.
Build/pack/test/fixture success is not deployment or registry publication.
Production activation is separate, authorized, backed up and forward-migrated.

- [Integrated commands](development.md)
- [Scenario inventory](../services/crossfire/tests/contracts/README.md)
- [Native selection and limitations](architecture/native-implementations.md)

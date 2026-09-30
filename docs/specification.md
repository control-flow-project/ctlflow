# Crossfire, fleetd and fleet specification

This is the canonical current product specification. Implementation and verification
must satisfy it as one coherent system. Work is greenfield: WCBUBWHB (What Can Be,
Unburdened By What Has Been), one implementation per capability, no compatibility
interfaces, aliases, hidden fallbacks or duplicated policy. A checkpoint is not
certification. Production data is never reset by these products.

## 1. Products and source ownership

The repository contains exactly three product roots:

```text
services/
  crossfire/
    apps/server/
    apps/web/
    apps/client/
    packages/
    tests/
    scripts/
    docs/
    skills/
  fleetd/
    apps/daemon/
    packages/domain/
    packages/contracts/
    packages/storage/
    tests/
  fleet/
    apps/cli/
    packages/daemon-client/
    packages/ssh-transport/
    tests/
```

Every product owns its applications, packages, tests and product-specific assets.
The root contains workspace/build coordination, repository instructions,
documentation and shared verification tooling; it contains no application source
or repository-wide package pool. Cross-project reuse is through declared package
exports and dependencies. Applications never import another application's source.
There is one listener and one native Codex integration, not per-product copies.
Only concrete, supported capabilities have packages.

- Crossfire owns identity, enrollment, human authorization, room access, native
  reconciliation, wake policies, listener activity, fleet grouping and React UI.
  Fleets do not confer room permissions, wake authority or a new agent kind.
- fleetd owns user-scoped controller configuration, registered fleet directories,
  fleet execution operations, native runtime ownership, automatic resumption and
  assembling runtime/coordination/listener adapters.
- fleet owns commands, presentation and local/SSH connections to fleetd. It calls
  the daemon API even locally. It neither launches agent runtimes nor independently
  applies orchestration rules.
- Controller and fleet execution are ordinary user processes. No systemd unit,
  privileged service, machine-wide skill/configuration, global permission change,
  public controller port or external execution scheduler is installed.
- GAAP owns its deployment/Element theme and domain-specific fleet definitions.
  Burrow is outside this implementation.

Three product package manifests and their nested workspaces share one root npm
lockfile. Each product has coherent build/test commands. Named exports, strict
TypeScript without any, functional modules, Result for expected failures,
explicit .js relative imports, validated boundaries, and semantic splits near
600 lines are mandatory.

## 2. User experience and lifecycle

The human starts a named daemon in a chosen controller root. The root holds
controller configuration and a registry of explicit fleet directories. Directories
may be under that root or elsewhere on the daemon's machine. There is no implicit
filesystem discovery. Each fleet directory is self-contained; runtime state and
Crossfire credentials travel with the stopped fleet directory.

The CLI supports:
- fleet daemon start --name NAME --root DIR
- fleet daemon status --root DIR
- fleet daemon stop --root DIR
- fleet remote add NAME --ssh USER@HOST --root DIR
- fleet --remote NAME list
- fleet add DIR; fleet list; fleet show KEY
- fleet start KEY; fleet stop KEY; fleet remove KEY
- fleet agent list KEY
- fleet agent add KEY INSTANCE --definition DEFINITION
- fleet agent start KEY INSTANCE; fleet agent stop KEY INSTANCE
- fleet agent remove KEY INSTANCE

Local commands identify their controller root explicitly or through the selected
CLI connection profile. Remote paths refer to the daemon's computer. SSH uses
normal host-key verification and user authentication; connection profiles do not
disable checks or contain copied SSH secrets. The same API is reached through
a private Unix socket locally and SSH stream forwarding remotely.

Starting the daemon does not start a model turn. Closing the management CLI or
its SSH connection does not stop the daemon. An explicit stop operation stops
the addressed owned listeners and runtimes; stopping the daemon stops its fleets.
Removal unregisters local membership without deleting retained files, native
history or Crossfire accounts. Removing an agent detaches fleet membership but
does not revoke its ordinary Crossfire identity.

First fleet start:
1. Validate all definitions, native options, instructions, paths and unique names.
2. Check every name before runtime launch. A known collision refuses the whole
   start. A later atomic name-claim collision fails only its affected instance.
3. Submit the exact roster through shared enrollment. Display one approval URL
   and code for the human, and wait in code without model polling.
4. The owner approves the displayed new identities and fleet connection.
   Room grants are a separate explicit human decision and start empty.
5. Privately exchange credentials and persist stable identity/session bindings.
6. Install verified project-local integration artifacts, start/resume each native
   runtime through the adapter and attach the shared listener automatically.

No agent is asked to discover ports, UUIDs, tokens, download releases, approve
itself, poll enrollment or report telemetry. Runtime connection metadata is passed
directly between code components, never copied through prompts. Codex receives
role/coordination instructions through native configuration. Starting, enrollment,
connection, release verification, filtering, approvals and heartbeats make zero
model calls. An authorized task/message is what starts model work.

Later start reuses private credentials, the same immutable identities, native
sessions and delivery positions automatically. No resume flag or replacement
identity is invented. New agents alone need new identity approval. Invalid
credentials or failed native resume produces a concrete error, not a fresh session.
A second live owner of the same local instance is denied. Portable-directory
proof is explicitly outside this task; portability remains the storage contract.

Linux native `flock` owns each daemon, fleet directory and receiver lifetime.
Locks are private retained inodes, held by an open file descriptor rather than
expiring leases. Suspension cannot create another owner; process exit releases
ownership without a stale-PID detector or deleting a shared lock inode.

Native settings (model, reasoning, sandbox, approval policy and cwd) are validated
and applied by the runtime adapter. Only stock Codex 0.158.0 or newer is supported.
Daemon orchestration contains no Codex-specific option translation. Native
authentication stays private and uses the user's authorized provider login.
The Codex adapter creates each work area's private `.codex` home. On first use,
it copies the user's private native login if the home has none; subsequent starts
retain that home's authentication. No controller credential enters model context.
Native thread creation and resumption receive the validated model, reasoning,
permission and instruction configuration. An initial native history read persists
an empty session without a dummy prompt, allowing zero-turn resumption.
Normal stop closes the listener and owned Codex process. Descendant-process
supervision and crash-proof tool cleanup are not product guarantees.

Incoming Matrix events are filtered and batched by ordinary code before model
delivery. The model chooses intentional replies/attachments through Crossfire's
messaging capability; arbitrary model output is never automatically broadcast.
Agent account, runtime state, reporting listener and applied room access remain
distinct observations. A zero-room agent is not advertised as receiving room tasks.

## 3. Controller descriptor and fleet authority

The shared controller descriptor is { name: string, metadata?: Record<string,string> }.
Name is a nonempty bounded display label. Metadata has bounded key count/key/value
sizes, is stored and returned, and has no routing, permission or execution meaning.
It must not contain credentials or be used to expose private connection details.
There is no separate Crossfire controller-management API.

fleetd has one descriptor from its own configuration; all of its fleet responses
derive that descriptor. Crossfire stores the descriptor reported through approved
enrollment or an authenticated fleet update. Offline views label it last reported,
not proof of a live controller. Existing agent listener heartbeats own online
status; a controller label never causes a model call or authenticates a request.

A fleet is identified externally by immutable UUID and internally has a unique
(owner, fleet key). Agent identities remain immutable and belong to one human.
A fleet may group only that owner's agents. Native room invitations may cross
owners independently of fleet membership. One agent binds to at most one fleet
instance. Detachment removes the grouping, not the account, grants or native data.

One initial owner approval issues a private fleet-scoped controller credential
alongside approved agent credentials. Its verifier is stored, never the secret.
The credential can read/update that fleet's reporting metadata, bind/detach proved
owned agents and introduce new enrollment requests for that fleet. It cannot
approve enrollment, change roles/room permissions/wake policy, access other
fleets or impersonate a human Matrix login. Owner suspension/revocation disables
the credential. New agents still require explicit owner approval. Names and
public IDs alone cannot recover credentials or replace fleet authority.
The credential is controller-private, not model instructions.

## 4. Domain and adapters

### Dependency direction

```text
HTTP / CLI / worker entrypoints
              |
              v
Functional domain use cases
              |
              v
Domain-owned repository and external-service ports
              |
              +--> SQLite adapter --> Tinqer --> SQLite
              +--> Matrix adapter --> native homeserver

Fleet core --> runtime port -------> Codex adapter
           --> coordination port --> Crossfire adapter --> Crossfire API / Matrix
           --> local-state port ---> filesystem adapter
```

Only composition roots instantiate concrete adapters. Domain code imports no
HTTP framework, database driver, Tinqer expression, concrete adapter, UI type or
process launcher. An adapter implements a domain/core-owned port; it does not
define the application's authority rules.

The useful reference patterns are Lesser's singular relational names, explicit
repository interfaces, functional per-operation modules and row/entity mappers;
and Snapped's transport/domain separation, composition, per-operation permission
checks and batched read projections. Frameworks, process counts, historical
migration machinery and unimplemented database backends are not requirements.

### Naming and source conventions

- SQL tables and columns use singular `snake_case`: `agent_room_grant`,
  `agent_id`, `created_at`. Every owned application table follows this rule.
- Entity names use PascalCase, values/functions use camelCase, and module paths
  use kebab-case. Concern directories use singular concepts, such as `agent`,
  `enrollment`, `room-access` and `authorization`.
- Repository types are `AgentRepository`, `EnrollmentRepository`, etc.; factories
  are `createAgentRepository`, `createEnrollmentRepository`. No `I` prefixes,
  classes, generic CRUD superclass, service locator or untyped context.
- Named exports and explicit `.js` relative imports are mandatory. Cross-package
  imports use declared workspace package exports, not source-directory reach-through.
- Each domain use case receives only its required dependencies and a verified
  actor. It returns `Result<T>`; expected denial/conflict is not an exception.
- `kernel` owns the shared Result primitive and opaque ID primitives. It owns no
  HTTP status mapping. `domain` owns business entities, errors and authorization.
  `contracts` owns wire schemas and operation declarations, never DB rows.
- Domain types do not import API DTOs. Contracts can use public pure domain
  value definitions; the dependency never points back from domain to contracts.
- SQLite row types exactly match storage. Explicit mappers validate stored
  discriminants and produce entities/read projections without unchecked casts.
- Modules split around semantic responsibilities, normally before 600 lines.
  A directory is not a dumping ground for unrelated utility functions.

Repository operations are synchronous `Result<T>` on the supported synchronous
SQLite backend. External-service ports return `Promise<Result<T>>`. There is no
fake asynchronous repository work inside a synchronous native transaction, and
no placeholder alternative backend.

### Component ownership

| Component | Sole responsibility |
| --- | --- |
| Domain | Identity, role/permission evaluation, enrollment, name allocation, desired room access, invitation provenance, wake policy, listener activity, notices, policy and audit intent. |
| SQLite adapter | One schema, integrity constraints, Tinqer repositories, row mapping, indexed queries, transactions and page-wide projections. |
| Matrix adapter | Native account, room, power, membership, media and event operations; map native facts/failures into domain ports. |
| Server | Configuration, composition, authentication boundary, routing and worker scheduling. |
| Fleet core | Roster validation, local work/state ownership, coordinated instance lifecycle and per-instance outcomes. |
| Runtime adapter | Validate native options, create/resume the exact session, expose its delivery/approval binding, stop its owned connection/process. |
| Coordination adapter | Preflight, enrollment, approval waiting, credential exchange, coordination attachment, release/activity/disconnect communication. |
| Shared listener core | One bounded acquisition/wake/batch/cursor/receipt/control path per instance; no native transport or model-driven housekeeping. |
| Filesystem adapter | Private project-local state, atomic files, owned local locks and validated paths. |
| Management UI | Human review/actions and truthful resource views using the same API contracts as the CLI. |
| GAAP definitions | Research roles, native settings, instance roster and room topology. |

A native Matrix check is not replaced by a database permission. A UI check is not
an authorization boundary. HTTP handlers and workers call the same domain use
cases; authorization cannot be bypassed by selecting a different entrypoint.

### Repository and transaction boundary

Focused repositories expose meaningful operations such as `findById`,
`findPage`, `findByOwner`, `claimName` and `saveGrant`. They do not expose
tables, SQL builders, arbitrary predicates or driver handles. Read projections
can join several tables; normalization does not require one query per row.

A typed unit of work supplies transaction-bound repositories to a synchronous
callback. Failure Results and exceptions both roll back. Async callbacks are
rejected. The implementation may use an internal rollback signal to invoke the
driver's rollback mechanism; expected failures remain Results outside it.
Native HTTP/process work stays outside the transaction.

Authorization facts and expected revisions are rechecked at commit. Desired
state, role/permission changes, name claims, provenance and audit commit together.
Native completion records compare the exact identity, generation and revision
they observed. Database commit means accepted intent, not verified Matrix
application.



## 5. Daemon REST API

HTTP/JSON uses the same envelope, validation, pagination and expected-error
conventions as Crossfire. The private controller root/socket is accessible only
to its Unix user. No public TCP listener is enabled. SSH is a transport adapter,
not another operation implementation. Unknown fields/routes/methods fail.

| Resource | Contract |
| --- | --- |
| GET /api/status | Controller descriptor and daemon health. |
| GET, POST /api/fleets | Paginated registry or register a validated explicit fleet directory. |
| GET, PATCH, DELETE /api/fleets/{fleetId} | Inspect, update allowed metadata/configuration or unregister. |
| GET, POST /api/fleets/{fleetId}/agents | List or add an instance using a validated existing definition. |
| GET, PATCH, DELETE /api/fleets/{fleetId}/agents/{instanceKey} | Inspect/update/remove an instance. |
| POST /api/operations | Idempotent start/stop request for a fleet, instance or daemon shutdown. |
| GET /api/operations/{operationId} | Observe accepted/running/awaiting-approval/succeeded/failed results. |

Operation creation accepts a client-generated UUID idempotency key, a typed target,
action and expected configuration revision. Reusing the key with different input
fails. Accepted does not mean running. Per-instance failures are preserved while
successful peers remain truthful. The daemon serializes conflicting operations
for the same fleet, bounds retained operation history and prevents duplicate
runtime/listener owners. Fleet state is derived from actual instance state, not
a second writable execution model. The CLI waits by API observation, not model use.
Only owned process handles may be signalled; no process-name scanning/killing.

## 6. Crossfire fleet REST API

| Resource | Contract |
| --- | --- |
| POST /api/enrollments/preflight | Shared bounded roster availability check. |
| POST /api/enrollments | Exact roster, proposed fleet/controller and private claim. |
| GET /api/enrollments/{enrollmentId} | Authorized human review of the exact request. |
| POST /api/enrollments/{enrollmentId}/decision | Owner decision; administrator may reject but not approve as another owner. |
| POST /api/enrollments/{enrollmentId}/exchange | Private request obtains status and ready credentials. |
| GET /api/fleets | SQL-paginated own/all authorized views including controller and activity summaries. |
| GET, PATCH, DELETE /api/fleets/{fleetId} | Read/update/delete grouping. Deletion never revokes agent accounts. |
| GET /api/fleets/{fleetId}/agents | Paginated ordinary agent projections. |
| PUT, DELETE /api/fleets/{fleetId}/agents/{agentId} | Authorized, revision-checked association/detachment. |

Crossfire has no fleet execution/start/stop, SSH, host-control or runtime-options
routes. Its fleet page shows members, named controller, approved identities,
reporting listeners and ordinary room/wake controls. Humans see their fleets;
administrators can inspect all. A controller credential is restricted to its
exact fleet; neither fleet grouping nor controller metadata grants room access.

## 7. Fleet definitions and persistence


There are three fleet TOML kinds, with one owner for every setting. Unknown fields,
duplicate keys and invalid values fail validation before startup. Examples below
define the concrete file schema; placeholder model/room values are not
claims of availability.

### Fleet roster: `runtime.toml`

```toml
fleet = "gaap-equities"

[coordination]
adapter = "crossfire"
server = "https://gaap.lol"
owner = "@yourname:gaap.lol"
approval_room = "!verified-approval-room-id:gaap.lol"

[[instances]]
key = "ocr-east"
name = "ocr-east"
definition = "document-converter"
workarea = "agents/document-converter/workarea/ocr-east"

[[instances]]
key = "ocr-west"
name = "ocr-west"
definition = "document-converter"
workarea = "agents/document-converter/workarea/ocr-west"
```

- `fleet` is stable within the authenticated owner.
- Each instance has a stable key, registered name, definition reference and
  distinct relative work area.
- `definition` resolves to `agents/<definition>/agent.toml`.
- The coordination block is supplied once for the fleet. It has no password,
  access token, runtime endpoint or thread ID.
- Optional `approval_room` selects the native room for owner permission requests
  across the fleet. It is routing configuration, not a room grant; the room plan
  must separately authorize the affected instances to use it. Management can
  include the selected approval room in the copied fleet connection block.
- Model, reasoning, sandbox and approval settings belong to the definition,
  not to instance overrides in the roster.

Fleet, definition and instance keys, and registered agent names, use the
project-local profile identifier form: a lowercase letter followed by lowercase
letters, digits or hyphens, at most 40 characters. Labels intended for humans are
separate from these identifiers. Every entrypoint uses the same validator and
exact canonical-name comparison; no entrypoint silently rewrites a name.

### Role: `agents/<definition>/agent.toml` and `AGENTS.md`

```toml
name = "Document Converter"
runtime = "codex"

[runtime_options]
model = "VERIFIED_MODEL_ID"
model_reasoning_effort = "high"
sandbox_mode = "workspace-write"
approval_policy = "on-request"
```

`name` is the definition's human-readable label, not an account name. Its
companion `AGENTS.md` supplies the shared role instructions through the native
runtime's instruction mechanism. Identity-specific context, where needed, is
generated deterministically rather than maintained as copied role documents.

The runtime adapter owns the typed `runtime_options` schema and native settings
translation. Model/reasoning settings reach the headless native session directly.
The roster's work area supplies native cwd. Permission settings retain native
semantics; unsupported settings fail rather than being ignored or elevated.

Instances sharing a definition share its settings and instructions, not mutable
session state. Different settings require a different definition. Secrets and
shell command strings are not part of these tracked files. Runtime transport,
authentication and process ownership remain controller-controlled.

### Room plan: `rooms.toml`

```toml
fleet = "gaap-equities"

[[agents]]
instance = "ocr-east"

[[agents.grants]]
room = "!verified-room-id:gaap.lol"
access = "reply"
muted = false

[[agents]]
instance = "ocr-west"

[[agents.grants]]
room = "!second-verified-room-id:gaap.lol"
access = "read"
muted = false
```

A grant contains `room`, `access` and `muted`; `access` is `read`, `reply` or
`custom`. Only `custom` includes an integer `level`. Authorization uses immutable
room IDs; names and aliases are display labels.

The file is a **full replacement for each listed agent**. Unlisted agents are
untouched. For a listed agent, omitted grants are removals. An explicit
`grants = []` removes all its grants. Unknown identities are errors, not
enrollment requests.

The selected fleet's immutable UUID plus `instance` resolve the immutable agent
ID; the TOML `fleet` key must match that selected fleet. An administrator can
therefore review identically named fleets belonging to different owners without
ambiguity. The human does not transcribe account UUIDs. This file contains no local
paths, native settings, commands or credentials. Wake policies and invitation
delegation are independent management settings, not implied by room grants.

### Self-contained layout

```text
fleet/
  runtime.toml
  rooms.toml
  .fleet/                         private fleet/run/enrollment state
  agents/
    document-converter/
      agent.toml
      AGENTS.md
      workarea/
        ocr-east/
          .codex/                 native home, authentication and session data
          .crossfire/             identity, client release and delivery state
          ...                     instance work and artifacts
        ocr-west/
          .codex/
          .crossfire/
          ...
```

The fleet directory owns every persistent reference required for resumption.
Durable local paths are relative to that directory or the owning instance.
Machine-specific runtime paths are resolved at use time, not stored as the only
means of finding state.

The fleet manifest owns roster-to-instance bindings and enrollment claims.
Each native adapter owns its session state; Crossfire owns its identity and
delivery state. These records do not become competing copies of authority.

Work areas are distinct and non-overlapping. Path validation prevents escaping
the chosen fleet directory. Private directories use mode 0700 and secret/state
files mode 0600, with atomic writes where interruption could corrupt bindings.
`.fleet/` and `**/workarea/` are Git-ignored; definitions remain trackable.
Generated files and logs do not expose credentials.

Provider authentication remains adapter-owned and private. A fixture provider
does not certify a real user's login or model entitlement. The product cannot
depend on another machine's global session directory to resume this fleet.


## 8. Shared enrollment and names

The durable server mapping is:

```text
(owner Matrix ID, fleet key, instance key) -> immutable agent UUID
```

Registered agent names are unique across all owners on one Crossfire instance,
including single-agent enrollment, fleet enrollment and authorized rename.
Mutable native display names do not own identity or uniqueness.

### Preflight

The controller validates duplicate names/keys locally and asks the server about
the complete intended roster. Any name collision refuses the whole start before
runtime launch or enrollment mutation. Capacity failures are also reported here.

Authenticated existing identities may reuse their own registered names.
A public name, fleet key or owner ID alone does not prove that identity and
cannot retrieve credentials. Missing private state is not permission to take
over a matching server record.

### Authoritative claims

Preflight reports availability; it does not reserve names. Introduction performs
an atomic claim for each new registered name against one server-side uniqueness
constraint shared by all creation/rename entrypoints.

If a name is taken between preflight and introduction, only that instance fails,
with an explicit name-collision error; its runtime does not start. Successfully
claimed peers can continue. There is no suffixing, automatic rename, takeover
or creation under another identity.

Pending claims are bounded by enrollment expiry and policy capacity. Rejected
or expired claims cannot confer accounts or room access. An approved identity
retains its binding through restart, upgrade, suspension and revocation; a
revoked binding is not silently recycled into a new account.

The approval page identifies claimed new entries, authenticated existing entries
and collision failures separately. The one approval covers exactly the displayed
new claimed roster. Changing that roster invalidates its review; a concurrent
collision is not permission to approve a different hidden subset.


All routes in this section are normative product contracts. Shared contract modules own request/response
validation, expected failures and bounded payloads.

| Route | Authority and effect |
| --- | --- |
| `POST /api/enrollments/preflight` | Bounded, rate-limited roster availability/capacity check. Existing-identity exemptions require its private authentication. No claims, credentials or runtime mutation. |
| `POST /api/enrollments` | Introduce the roster with persisted private idempotency material. Return per-instance outcomes and one new-identity approval request for successfully claimed entries. |
| `GET /api/enrollments` | Paginated human owner view; administrators can inspect all. No private claim material. |
| `GET /api/enrollments/{id}` | Human review of the exact roster, code, expiry, decision and per-instance provisioning status. |
| `POST /api/enrollments/{id}/decision` | The named owner approves or rejects the reviewed new roster. An administrator may reject another owner's request, not approve it. |
| `POST /api/enrollments/{id}/exchange` | The initiating private claim obtains status and ready credentials during a bounded recovery lifetime. Credentials never appear in human/browser responses. |

Enrollment receives only coordination identity information: owner, fleet,
instance keys, registered names the reporting controller descriptor and private request/authentication material.
It rejects definitions, model settings, work areas and local commands.

The controller persists its private idempotency key and claim secret before
submission. The server stores appropriate verifiers, not loggable credentials.
The same authenticated private request and identical roster returns the same
result; conflicting reuse fails. Exchange is repeatable within its bounded
lifetime so an interrupted local write does not create another identity.

A lost claim with no surviving private proof is not recoverable through public
roster lookup. Recovery must require the named owner's authenticated authority;
it cannot use a Matrix password requested by an agent.

Approval transactionally creates/reserves all reviewed successful new identities
with zero grants and owner-only wake policy. Native account provisioning occurs
outside the SQLite transaction and can be pending or fail per instance. Retry
retains the same identity. The UI and controller expose that actual state.

Capacity counts identities, including reserved pending identities, rather than
counting a fleet as one account. The same owner/global policy applies to single
and fleet enrollment and is checked transactionally at claim and approval.
Twenty-instance approval must work when configured capacity permits twenty;
the controller never bypasses a configured limit or divides one approval into
hidden batches.

Request, roster, claim, parsing and response bounds are published and tested.
The selected bounds must support the twenty-instance acceptance flow, including
its room-plan review, without hidden request splitting. Policy rejection states
the actual limit and the required administrator action.

Single-agent and fleet workflows use the same name, issuance, capacity,
provisioning and audit owners. Both submit the same bounded item-list contract;
a single-agent request has one item and no fleet key. The same routes, request
record, decision transaction and per-item provisioning path serve both.


## 9. Room authorization and invitations

| Route | Authority and effect |
| --- | --- |
| `POST /api/room-grant-previews` | Authenticated human, same-origin/CSRF protected. Validate and normalize the entire plan, resolve identities and current room facts, return diff/digest and expected agent revisions. No permission mutation. |
| `POST /api/room-grant-changes` | Confirmed exact plan, digest and expected revisions. Recheck current authority, then atomically write desired grants for all listed agents or none. Native application is asynchronous. |

Management parses bounded TOML into the shared validated JSON grant contract.
TOML is an input format, not another database representation.

Owners may add/remove their own agents. Administrators may add/remove any agent.
An explicitly authorized agent may add another agent, including another owner's
agent, and remove only membership additions attributed to that inviting agent.
All entrypoints use the room-access authorization in this section.

Single-agent, bulk and delegated invitation actions share authorization and
grant normalization. Each grant records its authorizing principal and addition
provenance. They use that authority's current native Matrix membership, room
eligibility and power ceiling, including custom levels. A grant cannot exceed
its authorizing authority. Cross-owner additions retain their actual authority
rather than inventing target-owner membership or losing access at reconciliation.
Each agent retains the 100-grant bound.

Preview shows each agent, room name/alias/ID, current and proposed access, native
ceiling, increases and removals. Apply rejects stale revisions, changed input,
lost authority, revoked identities and invalid targets as one operation, not a
partially applied desired-state subset. A preview is never an authorization token.

One immediate database transaction writes desired changes and audit records.
The reconciler owns Matrix application outside that transaction and reports
desired, pending, applied or failed accurately. Room membership is not claimed
to change atomically across the homeserver because a database transaction passed.

Grant revisions change for access changes; name/mute/metadata edits do not cause
unrelated membership rejoin or power elevation. Owner-ceiling reconciliation
uses the configured interval, default 300 seconds, with pending/failed restrictions
visible.

Room import neither enrolls identities nor creates rooms. Existing room
management is the human room-creation entrypoint. Agent bearer credentials
cannot apply a human bulk room plan.


### Required capability

An explicitly authorized agent can add another existing registered agent to a
room, including agents belonging to other owners. This permission authorizes the
cross-owner operation; there is no additional per-invitation owner approval.
Agents without the permission are denied. This does not authorize identity
creation, enrollment approval, process launch, ownership change or arbitrary
power escalation.

The room-access domain owns the decision, the coordination adapter exposes the
operation, and the Matrix adapter/reconciler owns native invitation and membership.
The request identifies inviter, target and immutable room; the authenticated
caller, not a supplied inviter field, determines acting authority.

Successful authorization must produce a durable permitted outcome. It cannot
report success after a native invite that the grant reconciler immediately
undoes. Desired authorization, native invitation, target acceptance and joined
membership remain distinguishable statuses.

The project client exposes `agent directory`, `room agent-access`,
`room invite-agent` and `room remove-agent`. The coordination adapter reads the
current grant and submits its exact revision/generation through the same REST
resource used by management. Native Matrix invites alone do not replace that
durable permission operation.

### Authority invariants

- Invitation capability is explicitly owner-delegated and absent by default.
  Management displays its scope and effective native permission.
- The inviter needs current Matrix invitation authority and the explicit
  Crossfire delegation. Native invitation permission alone does not authorize
  modifying another agent's durable grants.
- Owners may add/remove any agent they own. Administrators may add/remove any
  agent, regardless of owner or who added it.
- An agent may remove only a room addition recorded as made by that agent.
  It cannot remove an addition made by another agent, an owner or an administrator.
  Actor identity and addition provenance are server facts, never caller claims.
- A repeated add of an existing membership does not transfer its addition
  provenance. Remove/re-add creates a new membership generation; stale operations
  cannot claim authority over that new generation.
- Delegation is bounded to authorized rooms, eligible targets and permitted
  access. The result stays within all applicable owner/native ceilings.
- Inviting an agent does not automatically delegate onward invitation powers
  or change its wake policy.
- Direct native invitations do not establish Crossfire grant approval or bypass
  target authorization. Management does not claim a UI flag independently
  changes homeserver enforcement.
- Retry is idempotent; revocation or lost authority is rechecked at the owning
  operation. Audit records identify actor, target, room, membership generation,
  addition provenance and authorization.
- Target lookup reveals no private workspaces, session bindings or credentials.

### Canonical permission owner

One room-grant model owns access, authorizing authority and addition provenance.
Single-agent editing, bulk assignments and agent operations use that model and
its reconciler. There is no parallel invitation grant list, permission overlay
or caller-specific authorization shortcut. Native permission and membership
outcomes remain independently verified rather than assumed from a database write.


## 10. Listener delivery and human interaction

### Blocked-mention notices

An explicit native Matrix user mention of a receiving agent, from a sender
excluded by that agent's current wake policy, produces a deterministic notice
addressed to that sender: the receiver will not wake under its current rules.
It includes the verified owner's display name and Matrix ID as the person who
can configure those rules. Keep the text short; mention the sender, not the owner.
Plain display-name text, room-wide mentions, edits, self-messages and automatic
notices do not qualify. The receiver must have current, unmuted room access and
native permission to send the notice; this feature never increases room access.

Only the first qualifying message in a rolling ten-minute window receives a
notice for that sender–receiver pair, across all rooms. Reconnects preserve the
cooldown and event deduplication. A failed or uncertain send is retried only with
its same native transaction identity, never as another notice. Bounded private
state tracks notices separately from model-delivery receipts.

The listener generates and sends notices directly through its coordination
adapter, without any model invocation, skill-driven action or telemetry prompt.
Notice events are marked control traffic and excluded from every Crossfire
listener's wake evaluation and model context, including later batched context.
They cannot form notification loops. Ordinary non-mention traffic stays silent.
Original blocked messages remain pending context and are delivered with the next
authorized trigger under the normal ordering, debounce and size limits.

Acceptance covers exact mentions, sender/receiver isolation, cross-room cooldown,
the ten-minute boundary, restarts, retries, read-only/muted rooms, self/notice
exclusion and a later authorized batch containing the original messages but no
automatic notices. All notice and idle controls produce zero model requests.

### One receive and receipt owner

Each instance uses one bounded receiver with persisted ordering, cursor and
native receipt handling. Idle polls do not enter model context. Receipt-confirmed
publication owns advancement; an uncertain failed send cannot silently consume
unread messages.

Initial recent history remains pinned while waiting for wake authority. A room
membership reset retires that room's initial boundary, not other rooms' context.
Newly granted rooms establish their boundaries without replacing already pinned
messages. Pinned context still uses the shared bounded batch and receipt path.

The runtime adapter durably journals the exact input identity/content and native
history boundary before publication. A confirmed receipt remains durable until
the shared receiver commits its cursor/control checkpoint and acknowledges it.
Restarting the native engine cannot replay a confirmed input. A lost RPC response
is resolved only against the captured native history interval and exact receipt;
an unprovable publication stops explicitly with unread positions unchanged.
Native client IDs are correlation, not an assumed native deduplication guarantee.
The private per-session journal allows one pending publication and at most 128
unacknowledged confirmations; it refuses excess rather than silently evicting
unsettled evidence. This is runtime state, not a second Matrix cursor owner.

Allowed wake authors are configured in management:

| Policy | Wake authority |
| --- | --- |
| `nobody` | No room author wakes the agent; direct runtime input is independent. |
| `owner` | Verified owner only; default. |
| `owner-agents` | Owner and that owner's agents. |
| `humans` | Owner, owner's agents and other humans. |
| `everyone` | Humans and their agents. |
| `selected` | Only the explicitly selected verified people and agents. |

Selected-author configuration is a bounded set of immutable Matrix identities,
not display-name matching or a permission level in the predefined-mode ordering.
The management editor offers search, human/agent filters, checkboxes, selected
count and clear identity/owner labels. Selected entries remain visible while
searching or paging; saving replaces the complete selection atomically with
revision checks. Empty selection wakes nobody. The owner is not implicitly
included; the agent never wakes itself.

The server resolves all modes through one wake-authorization owner. Suspended
or revoked identities and agents whose owners are inactive cannot wake listeners.
Renames do not retarget a selection. The listener receives the resolved allowed
authors and applies the same batching/receipt path for every mode. Search, save,
policy refresh and filtering involve no LLM calls. Changing modes is configuration,
not an additional receiver or an extra model prompt.

Non-waking messages remain eligible context. When an authorized message arrives,
the listener delivers accumulated ordered context together with the trigger in
one batch whenever it fits the configured bounds. Debouncing coalesces messages;
it does not turn a collected trail into one model call per event. Larger input
uses the established bounded ordered batching without dropping context.

Room membership, role titles and invitation authority do not create wake
authority. A director-to-worker workflow needs an explicit compatible wake
policy. Selected meaningful room-state notices use the same receiver and
receipt path rather than a separate listener.

### Native tool approvals

The runtime adapter decodes exact native permission requests. The Crossfire
permission path sends them to an explicitly authorized approval room and accepts
only the verified owner's explicit matching native decision.

The fleet coordination block supplies that room once. Each affected listener
validates its actual applied access before advertising approval readiness.

Approval responses are control input, not model input, and do not alter wake
policy or resume paused delivery. Silence, unrelated messages and another human's
reply do not approve. A policy needing approvals without a usable approval room
has a visible setup error/state; it is not silently changed to no-approval mode.

A user-selected native no-approval policy is a deliberate configuration choice,
not a launcher default or model-authorized elevation.

### Releases and listener activity

Reconnect checks the manifest and verifies artifact sizes/hashes before starting
software. Changed skill content is supplied through the adapter's native context
mechanism, without requiring a separate model-led installation conversation.

An incompatible client reports the required update and does not pretend to be
connected. Running listeners are not silently hot-replaced. Updating software
preserves identities, native sessions, grants and cursors.

Each listener reports release, run identity and heartbeat automatically, using
the shared activity implementation: 30-second heartbeats and offline after
90 seconds without a heartbeat. Management shows observed active time,
receipt-confirmed message counts and last seen. Online means a reporting
listener, not proof of model progress or native Matrix presence. No token
telemetry or model calls are used for this reporting.

The owner's confirmed management disconnect stops the selected listener through
the existing server-driven control. Disconnecting coordination is not authority
to kill unrelated or externally owned runtimes.


## 11. Normalized persistence and authorization

This schema and its permission model are authorized for implementation. Crossfire has no
production users/data. Its selected development state can be recreated from one
canonical schema; implementation does not need a historical-schema reader,
importer, compatibility handler, migration chain or dual read/write path.
Reset is explicit, never an automatic reaction to a startup error. Source work,
operator configuration, external credentials and other projects remain intact.

### Relational conventions

All twenty-seven application tables have singular snake_case names. Tables are
STRICT and foreign keys remain enabled. Timestamps/durations use integer
milliseconds; revisions/counters are checked nonnegative integers. Boolean
data properties use checked integers, but delegated capabilities are permission
rows, not boolean columns.

Entity IDs are opaque UUID text. Fixed catalog codes and natural/composite keys
identify reference rows and relationships. PK/UQ/FK below mean primary, unique
and foreign keys; `?` marks nullable columns. All other fields are required.
Account kinds, lifecycle states, access modes, wake modes and operation outcomes
have closed checked domains. TypeScript entities use camelCase; row types match
SQL exactly.

No table stores permission sets, grants, selections, roster entries, settings or
application state as JSON, comma-separated strings or serialized objects.
Actual message bodies and human-readable audit messages are text values, not
containers for hidden relational state. Protocol JSON exists at API/Matrix/file
boundaries, not as the management database's data model.

### Identity and role tables

| Table | Complete logical columns and keys |
| --- | --- |
| `principal` | `id PK`, `matrix_user_id UQ`, `kind`, `status`, `revision`, `created_at`; `UQ(id, kind)`. |
| `member` | `principal_id PK`, `principal_kind = human`, `display_name`; composite FK to `principal(id, kind)`. |
| `agent` | `principal_id PK`, `principal_kind = agent`, `owner_id FK member`, `display_name_override?`, `wake_mode`; composite principal-kind FK; `UQ(principal_id, owner_id)`. |
| `agent_credential` | `agent_id PK/FK agent`, `provisioning_password`, `access_token?`, `updated_at`. |
| `principal_application` | `principal_id PK/FK principal`, `applied_revision?`, `applied_intent_hash?`, `applied_status?`, `native_display_name?`, `last_attempt_at?`, `last_success_at?`, `next_check_at`, `error_code?`, `error_message?`. |
| `permission` | `code PK`, `grant_scope`, `description`; `UQ(code, grant_scope)`; grant scope is `role` or `agent_room`. |
| `role` | `code PK`, `principal_kind`, `label`; `UQ(code, principal_kind)`. |
| `role_permission` | `role_code FK role`, `permission_code`, `grant_scope = role`; composite PK on role/permission; composite FK to `permission(code, grant_scope)`. |
| `principal_role` | `principal_id PK`, `principal_kind`, `role_code`, `assigned_by_member_id? FK member`, `assigned_at`; checked composite FKs to principal and role by their kind. |

One transaction creates a principal, its exactly matching human/agent subtype
and its role binding. Repository operations do not expose incomplete principal
creation. The repeated fixed kind/scope values in relationship tables are FK
integrity discriminators, not independently configurable facts.

Built-in roles are `member`, `administrator` and `agent`. Each principal has
one role. Agent principals cannot hold a human role, enforced by the composite
FK as well as domain validation. Agents' fixed baseline role covers self
connection/reporting, not delegation or administrator powers.

A typed permission catalog owns stable action codes and their grant scopes.
It supplies canonical reference data to `permission`, `role` and
`role_permission`; there is no separate hand-maintained role-to-permission map.
Permission assignment is read from these relations. This release does not add
custom role creation, a policy-language interpreter, wildcards or role inheritance.

Representative role permission codes distinguish the actual authority:
`agent.read.self`, `agent.read.owned`, `agent.read.any`,
`agent.configure.owned`, `agent.configure.any`,
`agent.room-grant.manage.owned`, `agent.room-grant.manage.any`,
`agent.listener.disconnect.owned`, `agent.listener.disconnect.any`,
`listener.report.self`, `enrollment.approve.owned`,
`enrollment.reject.owned`, `enrollment.reject.any`,
`member.manage`, `policy.manage` and `audit.read.any`.
The implemented operation catalog and permission catalog must cover each other
in an architecture test. A role permission does not erase ownership checks or
pretend an administrator approved enrollment as another owner.

There is no role column in `member` or `agent` alongside `principal_role`.
General identity views cannot read `agent_credential`. Narrow credential
repository methods serve issuance and native account operations only.

### Enrollment, names and fleet tables

| Table | Complete logical columns and keys |
| --- | --- |
| `enrollment_request` | `id PK`, `owner_id FK member`, `fleet_key?`, `verification_code UQ`, `claim_hash`, `controller_name?`, `controller_credential_hash?`, `roster_digest`, `status`, `revision`, `created_at`, `expires_at`, `decided_by_member_id? FK member`, `decided_at?`. |
| `enrollment_item` | `request_id FK enrollment_request`, `instance_key`, `requested_name`, `outcome`, `agent_id? FK agent`, `failure_code?`; `PK(request_id, instance_key)`. |
| `agent_name` | `name PK`, `request_id?`, `instance_key?`, `agent_id? UQ/FK agent`; pending-item composite FK; `UQ(request_id, instance_key)`. |
| `fleet` | `id UQ`, `owner_id FK member`, `fleet_key`, `label`, `controller_name`, `revision`, `created_at`, `updated_at`; `PK(owner_id, fleet_key)`. |
| `fleet_controller_metadata` | `fleet_id FK fleet(id)`, `key`, `value`; `PK(fleet_id, key)`. |
| `fleet_credential` | `id PK`, `fleet_id FK fleet(id)`, `secret_hash`, `created_at`, `revoked_at?`. Fleet-scoped authority, not a human login. |
| `enrollment_controller_metadata` | `enrollment_id FK enrollment_request`, `key`, `value`; `PK(enrollment_id, key)`. Exact approval snapshot. |
| `fleet_instance` | `owner_id`, `fleet_key`, `instance_key`, `agent_id UQ`; `PK(owner_id, fleet_key, instance_key)`; composite FKs to `fleet(owner_id, fleet_key)` and `agent(principal_id, owner_id)`. |

One item or many items use the same request/decision/provisioning pipeline.
`requested_name` is an immutable review snapshot. Only `agent_name` owns the
current registered name. A name row points either to the complete pending item
key or to an assigned agent, never both or neither.

A request's fleet key is a proposed input, not authority or a reservation of
another owner's fleet. `fleet` and `fleet_instance` are established with
authenticated existing identity proof or the owner's approval, not through
anonymous lookup/preflight. The composite owner FK prevents cross-owner fleet
bindings. Runtime options, local paths and native sessions are not server data.

Expiry/rejection releases pending name claims. Assigned names and fleet
bindings survive request retention, suspension and revocation. Public keys
cannot retrieve credentials. Native provisioning observations are not another
enrollment decision state.

### Room permission and wake tables

| Table | Complete logical columns and keys |
| --- | --- |
| `agent_room_grant` | `agent_id FK agent`, `room_id`, `generation`, `authorizer_id FK principal`, `added_by_id FK principal`, `access_mode`, `power_level?`, `muted`, `revision`, `access_revision`, `updated_at`; `PK(agent_id, room_id)`; `UQ(agent_id, room_id, generation)`. |
| `agent_room_permission` | `agent_id`, `room_id`, `generation`, `permission_code`, `grant_scope = agent_room`, `granted_by_member_id FK member`, `granted_at`; `PK(agent_id, room_id, permission_code)`; composite FKs to the exact room-grant generation and `permission(code, grant_scope)`. |
| `room_grant_application` | `agent_id`, `room_id`, `observed_generation?`, `applied_revision?`, `applied_access_revision?`, `membership?`, `power_level?`, `last_attempt_at?`, `last_success_at?`, `next_check_at`, `error_code?`, `error_message?`; composite PK/FK to `agent_room_grant(agent_id, room_id)`. |
| `agent_wake_sender` | `agent_id FK agent`, `sender_principal_id FK principal`; composite PK; self-selection rejected. |

`agent_room_grant` is desired room access and addition provenance.
`agent_room_permission` is explicit scoped authority to act in that room.
`room_grant_application` is observed native state. These are different facts,
not overlapping permission systems.

The initial delegated capability is `room.agent.invite`: add existing registered
agents and withdraw only additions made by this inviter. It is absent by default,
owner/admin granted, room scoped, and tied to the current membership generation.
The UI's invitation checkbox adds/removes this permission row; there is no
`can_invite_agents` column, bitmask or duplicate permission list. Agent-created
target grants contain no onward delegation.

Granting/removing scoped permissions increments the parent grant configuration
revision, not its native access revision unless access itself changes.
Permissions are explicitly cleared when their grant generation ends; FK updates
cannot silently carry them into a new generation. `muted` is a delivery property,
not a delegated capability.

Add/remove decisions jointly check active identities, role/scoped permission,
target relationship, immutable addition provenance, expected generation/revision
and current native authority. Owners manage their agents; administrators manage
any agent. An inviting agent can cross owners but cannot remove another actor's
addition. Duplicate adds do not transfer provenance. Matrix membership/power
constraints remain authoritative for native effects.

Selected wake senders are a separate relationship from permission grants.
Invitation capability, room access or a role does not automatically grant wake
authority. Every policy uses the same wake resolver and buffered-context path.

### Session, activity, policy and audit tables

| Table | Complete logical columns and keys |
| --- | --- |
| `member_invitation` | `id PK`, `created_by_member_id FK member`, `claim_hash`, `role_code`, `principal_kind = human`, `created_at`, `expires_at`, `consumed_by_member_id? FK member`, `revoked_at?`, `claim_matrix_user_id? UQ`, `claim_display_name?`, `claim_fingerprint?`; composite role-kind FK requires a human role. |
| `member_session` | `secret_hash PK`, `member_id FK member`, `csrf_secret`, `native_access_token`, `created_at`, `expires_at`. |
| `listener_run` | `id PK`, `agent_id FK agent`, `release?`, `started_at`, `last_seen_at`, `active_ms`, `messages_delivered`, `stopped_at?`, `disconnect_requested_at?`. |
| `wake_notice` | `receiver_agent_id FK agent`, `event_id`, `sender_matrix_id`, `room_id`, `reserved_at`, `message_body`, `status`, `sent_at?`, `native_event_id?`, `next_attempt_at?`, `last_error?`; `PK(receiver_agent_id, event_id)`. |
| `instance_policy` | `id PK = instance`, `revision`, `max_owner_agents`, `max_agents`, `max_pending`, `enrollment_seconds`, `reconcile_seconds`, `agent_instructions`. |
| `audit_event` | `id PK`, `request_id`, `actor_kind`, `actor_principal_id? FK principal`, `actor_credential_id?`, `owner_id? FK member`, `target_kind`, `target_id`, `room_id?`, `membership_generation?`, `authorizer_id? FK principal`, `added_by_id? FK principal`, `permission_code? FK permission`, `action`, `outcome`, `message`, `created_at`. |

Known signup-claim components are all present or all absent. The human-role
restriction on `member_invitation` is enforced in storage as well as validation.
Permission catalog/subtype checks have corresponding database constraints, not
just TypeScript assertions.

Notice bodies are immutable text including the verified owner label/ID.
The Matrix adapter renders the fixed control-event envelope from the stored
body, verified sender and stable event identity; retries cannot regenerate
different prose or involve the LLM. Notice reservation/cooldown/event
deduplication are atomic. One unresolved reservation per sender-receiver pair
prevents a retry racing another publication. Retention cannot erase unresolved
publication or the live cooldown. A native sender may not be registered with
Crossfire, so `sender_matrix_id` is deliberately an external identifier.

Audit events are append-only, attributed facts. Bulk operations emit the
necessary per-target records under one request ID in the same transaction.
Actor kind distinguishes authenticated principals, private enrollment claims
and system operations, including a fleet controller's credential identity. The
historical credential identifier is not a live FK: deleting a fleet cannot erase
its audit attribution. Queryable actor/owner/target/room/generation/provenance/
permission facts are columns; `message` is readable audit copy, never serialized
permission or roster state. No generic JSON `detail` or untyped property bag.
Historical target identifiers may describe expired requests or external rooms;
they do not confer authorization and deliberately need not reference a live row.

Account/grant application rows record native observations. The account intent
hash covers the exact native intent, including owner-qualified presentation
dependencies; it is not another writable configuration. An observed grant
generation may differ from the current desired generation. Completion writes
must compare all relevant current identity/authority revisions before publication.

Crossfire does not duplicate Matrix's room/event/media/power database or a
runtime's native session store. Opaque external IDs and native facts are handled
by their adapters. Database normalization does not authorize new platform scope.

### Index and query contract

Every PK/UQ supplies its constraint index. Additional indexes follow
`ix_<table>_<purpose>` naming and correspond to concrete queries:

| Table | Additional index keys | Query |
| --- | --- | --- |
| `principal` | `(kind, status, id)` | Active directory and account capacity. |
| `agent` | `(owner_id, principal_id)` | Owner scope, capacity and lifecycle fan-out. |
| `principal_role` | `(role_code, principal_id)` | Role membership and last-admin protection. |
| `role_permission` | `(permission_code, role_code)` | Permission coverage/reverse lookup. |
| `principal_application` | `(next_check_at, principal_id)` | Bounded reconciliation. |
| `enrollment_request` | `(owner_id, created_at, id)`, `(created_at, id)`, `(status, expires_at, id)` | Review lists and pending expiry/capacity. |
| `enrollment_item` | `(agent_id, request_id, instance_key)` | Existing identity and provisioning references. |
| `fleet` | `(created_at, fleet_key)` | Global fleet list. Owner lists use the composite primary-key prefix. |
| `fleet_credential` | `(fleet_id, revoked_at)` | Fleet credential lifecycle. |
| `agent_room_grant` | `(room_id, agent_id)`, `(authorizer_id, agent_id, room_id)`, `(added_by_id, agent_id, room_id)` | Room views, authority loss, provenance. |
| `agent_room_permission` | `(permission_code, room_id, agent_id)`, `(granted_by_member_id, agent_id, room_id)` | Effective delegation and delegator lifecycle. |
| `room_grant_application` | `(next_check_at, agent_id, room_id)` | Bounded grant application. |
| `agent_wake_sender` | `(sender_principal_id, agent_id)` | Sender lifecycle invalidation. |
| `member_invitation` | `(created_at, id)`, `(expires_at, id)` | Admin listing/expiry. |
| `member_session` | `(member_id, expires_at)`, `(expires_at)` | Session limits/revocation/expiry. |
| `listener_run` | `(agent_id, last_seen_at DESC, id)`; partial `(last_seen_at, agent_id, id)` for unstopped runs | History, totals and online selection. |
| `wake_notice` | `(receiver_agent_id, sender_matrix_id, reserved_at DESC)`; partial UQ on receiver/sender for unresolved status; `(status, next_attempt_at)` | Ten-minute cooldown and retry ownership. |
| `audit_event` | `(created_at DESC, id DESC)`, `(actor_principal_id, created_at DESC, id DESC)`, `(owner_id, created_at DESC, id DESC)`, `(target_kind, target_id, created_at DESC, id DESC)`, `(request_id, id)` | Global/scoped history and one operation's records. |

Keys already cover the remaining table lookups. Permission/key prefixes are not
indexed twice merely for appearance. Role/permission reference data is small;
a generic cache is not part of this design.

Repositories execute filtering, ordering, counts and paging before hydration.
Owner-scoped queries do not contain a parameterized administrator-OR-owner
condition that prevents an owner seek. Distinct authorized scopes select
explicit query shapes inside one repository implementation. Activity summaries
are page-wide aggregate projections, never several queries per agent.

Room-grant collections accept an optional `roomIds` query value: a JSON array of
at most 100 distinct opaque native room IDs, bounded to 16 KiB before parsing.
Filtering precedes counting and paging. The agent room table requests grants for
its displayed room page, never assumes the first grant page contains every room.

Indexes do not make arbitrary substring search constant-time. Directory search
is bounded by supported policy capacity. Verification uses actual Tinqer SQL,
`EXPLAIN QUERY PLAN`, query counts and representative cardinalities. Bounded
page-number queries may scan skipped matching index entries; that cost is
measured, not advertised as keyset access. No speculative FTS/cache or query
bypass is justified merely by the proposal.

### Storage and runtime safety

Tinqer owns all application reads/writes. Raw SQL is restricted to schema,
configuration and metadata/query-plan inspection. Private store creation and
credential access remain validated and access-restricted.

Private controller state is project-local and atomic. Public availability checks
return no credentials or private workspaces. Enrollment claim proof and exact
roster/digest bind approval/exchange. Preview/apply binds the normalized plan and
expected revisions; a preview is not an authorization token.

Native provisioning and network calls occur outside SQLite transactions.
Reconciliation applies one desired-state model with finite concurrency, timeouts
and truthful pending/failure reporting. No model call performs permission,
version, heartbeat, notice, filtering or lifecycle housekeeping.

The CLI uses ordinary user privileges and touches only selected project/fleet
state and its owned children. No global skill, privileged service, host permission
change or machine-wide configuration is part of this architecture. Logs and
public responses redact credential/claim material.


## 12. REST conventions and resource inventory

Crossfire exposes REST/JSON only. It does not add GraphQL. The canonical product
API prefix is `/api`; Matrix's native `/_matrix` endpoints and immutable release
artifacts under `/onboarding/<releaseId>/` retain their separate protocol/asset
ownership. The management website remains under `/manage`.

### Uniform rules

- Collections use plural kebab-case nouns; singleton subresources use singular
  names. SQL table names remain singular: the convention is explicit per layer.
- Entity fields are camelCase with precise names: `agentId`, `ownerId`,
  `matrixUserId`, `roomId`, `createdAt`. Crossfire IDs are opaque UUIDs; Matrix
  IDs remain native opaque strings. Encode each path segment exactly once.
- One operation declaration owns method/path, request/response schema and
  authentication requirement. Typed UI/CLI clients and API documentation derive
  from it. Domain entities and SQLite rows are not serialized automatically.
- Unknown fields, invalid enums/IDs, duplicate query parameters, unbounded
  payloads and unsupported methods are rejected. There is no generic action
  dispatcher, arbitrary table endpoint or silent option forwarding.
- Collection reads use `page` and `pageSize`, with bounded page size, explicit
  documented filters and deterministic ordering. Response metadata contains
  `page`, `pageSize`, `totalItems`, `totalPages`. Filtering/counting happens
  before pagination, and counts obey the same visibility scope as items.
- Single-resource mutations carry `expectedRevision`; a grant mutation also
  identifies its expected membership generation. Bulk changes carry expected
  revisions for every affected aggregate. Missing/stale preconditions fail
  rather than silently merge unrelated edits. Create/claim operations use
  their explicit unique/idempotency keys.
- Success JSON is `{ data, meta: { requestId, ...pagination } }`.
  Error JSON is `{ error: { code, message, fieldErrors? }, meta: { requestId } }`.
  Codes distinguish invalid input, unauthenticated, forbidden, missing,
  stale revision, name collision, capacity, rate limit and native failure.
- HTTP status is meaningful: 200 read/update, 201 creation, 202 accepted pending
  native work, 400 invalid input, 401 unauthenticated, 403 forbidden, 404 absent
  or inaccessible resource, 409 conflicting state, 413 body bound, 429 rate
  limit and 502/503 native dependency failure. Domain Result knows no HTTP codes.
- Browser writes require same-origin authenticated cookies and CSRF protection.
  Agent operations use native authenticated bearer identity; mixed cookie/bearer
  authentication is rejected. The caller identity never comes from a payload.
- All handlers call the same domain authorization used by workers/CLI callers.
  Response `allowedActions` explains controls but does not confer authority.
  Administrator permissions do not forge another owner's approval, a native
  receipt or a listener heartbeat.
- Desired intent, observed native state and application status are distinct
  response fields. A 202 response never claims Matrix has already applied a grant.
- Credentials appear only in narrowly authenticated login/claim exchange, never
  list/detail/audit responses, URLs, error text or logs. Runtime paths/options
  are not accepted by enrollment or management routes.

### Resource inventory

| Method / path | Purpose and authority |
| --- | --- |
| `POST /api/sessions` | Human login; establish private cookie and CSRF state. |
| `GET, DELETE /api/sessions/current` | Read/end this human session. |
| `GET /api/principals` | Authorized, bounded identity discovery for wake selection and invitation targets; minimal directory projection. |
| `GET /api/roles`, `GET /api/permissions` | Read the fixed catalog, filtered by appropriate human/agent applicability. |
| `GET /api/members`, `GET, PATCH /api/members/{memberId}` | Authorized human directory/lifecycle management. |
| `PUT /api/members/{memberId}/role` | Explicit administrator assignment of one valid human role. |
| `POST, GET /api/member-invitations` | Administrator creates/lists human signup invitations. |
| `GET, DELETE /api/member-invitations/{invitationId}` | Authorized review/revocation. |
| `POST /api/member-invitations/{invitationId}/acceptance` | Private signup claim; no agent or administrator credential impersonation. |
| `POST /api/enrollments/preflight` | Pure bounded roster/name/capacity check. |
| `POST, GET /api/enrollments` | Introduce one/many identities; list requests under owner/admin visibility. |
| `GET /api/enrollments/{enrollmentId}` | Exact reviewed roster and application outcomes. |
| `POST /api/enrollments/{enrollmentId}/decision` | Owner approves/rejects; administrator may reject others' requests. |
| `POST /api/enrollments/{enrollmentId}/exchange` | Private initiating claim obtains status/ready credentials. |
| `GET /api/fleets`, `GET, PATCH, DELETE /api/fleets/{fleetId}`, `GET /api/fleets/{fleetId}/agents`, `PUT, DELETE /api/fleets/{fleetId}/agents/{agentId}` | Authorized durable fleet/instance views; not native process control. |
| `GET /api/agents`, `GET, PATCH /api/agents/{agentId}` | Scoped list/details and configuration/lifecycle changes. |
| `GET, PUT /api/agents/{agentId}/wake-policy` | One complete mode/selected-sender configuration. |
| `GET /api/agents/{agentId}/delivery-policy` | This authenticated agent's resolved native delivery policy. |
| `GET /api/rooms`, `GET /api/rooms/{roomId}` | Authorized native room directory/details; optional agent context for the assignment editor. |
| `POST /api/rooms` | Authorized human native room creation. |
| `GET /api/rooms/{roomId}/members` | Authorized native membership view. |
| `POST /api/rooms/{roomId}/membership-changes` | Authorized human invite/remove operations; agent targets go through the shared grant use case. |
| `GET /api/agents/{agentId}/room-grants` | Desired grants with their observed application and allowed actions. |
| `GET, PUT, DELETE /api/agents/{agentId}/room-grants/{roomId}` | One shared owner/admin/delegated-agent access resource; removal rechecks addition provenance and generation. |
| `GET, PUT /api/agents/{agentId}/room-grants/{roomId}/permissions` | Owner/admin reads/replaces this generation's complete scoped permission set. |
| `POST /api/room-grant-previews` | Validate/normalize a bulk plan and expose changes/digest/revisions; no mutation. |
| `POST /api/room-grant-changes` | Apply the exact confirmed plan atomically to desired state through the same grant domain. |
| `GET /api/agents/{agentId}/listener-runs` | Authorized run/version/activity history. |
| `PUT /api/agents/{agentId}/listener-runs/{runId}` | This agent reports ready/activity/stopped state under one stable run ID; server owns time/accounting. |
| `POST /api/agents/{agentId}/listener-disconnections` | Confirmed owner/admin request targets observed run IDs; acknowledgment and actual stop are separate. |
| `PUT /api/agents/{agentId}/wake-notices/{eventId}` | Idempotent model-free blocked-mention handling; verify original native event and current permission. |
| `GET, PATCH /api/instance-policy` | Read policy; administrator updates it, including instruction text. |
| `GET /api/audit-events` | Scoped, filtered and paginated immutable audit history. |
| `GET /api/releases/current` | Public current manifest/protocol requirements for deterministic installation/update checks. |
| `GET /api/health` | Bounded public readiness metadata without secrets. |

Single-agent and bulk routes are transport representations of the same domain
operations, not competing implementations. Native membership actions targeting
registered agents cannot bypass the durable grant model. Scope-changing routes
must declare their actor kinds and permission codes in the operation catalog.

The complete change includes server, management UI, CLI, runtime/coordination
adapters, bootstrap/onboarding copy, released client bundles, routing/deployment
configuration, tests and documentation. All owned consumers use this contract.
Removed routes/payload forms are rejected; no aliases or compatibility handlers
are retained. Public API examples and generated clients use the actual canonical
paths and payloads, not a second documentation-only model.

## 13. Management experience

React management uses one outer page frame and shared paper-like layouts.
Within that frame, typography, aligned gutters, whitespace and light separators
establish hierarchy. Sections, filters, tables, result lists, empty states and
supporting notes have no enclosing decorative boxes. Borders remain on controls
and meaningful alerts; focus, status and destructive-action cues stay explicit.
Account, onboarding, directory, detail and administration screens follow the
same treatment at desktop and mobile widths. Copy names the resource, state or
action directly: no slogans, promotional eyebrows, filler headings or decorative
empty-state illustrations. Necessary permission, lifecycle and security
explanations remain visible.

Fleet list/detail and durable agent/room routes show names first,
not opaque IDs. Owners see their scope; administrators may filter all owners.
Lists have useful status/search filters and pagination. Revoked entries are
explicitly included by filter. Fleet controller labels are visible in fleet
summaries and agent deployment context, without implying heartbeat freshness.
Each fleet's agents appear in a compact paginated table: linked agent name,
instance key, listener status and account status. Agent details are reached through
the name link; fleet rosters have no per-agent cards or duplicated detail controls.
Selected-author responses retain display labels for all selected principals,
independently of the current search/page. Empty optional UI filters are omitted
from URLs; an empty identifier is not a separate API meaning.

Room access offers native read/reply/custom levels up to the verified actor's
authority, with compact aligned controls and meaningful pending/applied errors.
Delegated invitations, provenance-limited removal and selected wake senders have
explicit controls; principal selection supports search and checkboxes. Bulk room
TOML has a full diff/confirmation and revision validation. Destructive operations
require confirmation; a disconnect targets observed listener run IDs only.

The Connect page provides short usable per-server instructions and an inspectable
detail area. Fleet connection configuration is copied once, not per agent. New
fleet approvals show exact names, failures, owner and controller. Existing identity
reconnection is never described as re-enrollment. Instructions and capabilities
are updated in ordinary code; runtime delivery remains the only model input owner.

System-wide agent message instructions are configurable only by the administrator,
with reset-to-default. Attachment download uses native authenticated Matrix media.
Management style stays consistent; GAAP Element branding has its own repository.

## 14. Verification and delivery

The dated necessity ledger at
.analysis/20260929-164420-fleet-handover/necessity-ledger.md records every capability,
owner, minimality/performance rationale and exact evidence. The checked-in spec
is normative; execution notes never substitute for implementation verification.

Required banks:
- Schema integrity, typed repositories, foreign keys, indexes/query plans,
  pagination/query counts, transaction rollback, no serialized domain state.
- Enrollment name races, exact one-roster approval, private credential recovery,
  scoped fleet credentials, membership changes/controller updates and no leaks.
- Native Conduit grants/invitations/removal, cross-owner authority/provenance,
  revocation, selected/nobody wake rules and durable blocked-mention cooldown.
- One receipt/cursor path, buffering/debounce/size limits, approvals and metadata
  reporting without model turns; no duplicated receivers after restart.
- Real stock Codex headless startup/options, private-home state, native
  input/receipt/output and same-session resumption, isolated inert provider,
  normal owned-engine shutdown, no production or paid-provider calls.
- Daemon HTTP/Unix ownership, typed operation idempotency, local/SSH transport,
  CLI error/status contracts, disconnected CLI survival and explicit stop.
- React browser flows for every management route, fleet/controller views,
  grants, principal selection, confirmations, auth boundaries and attachments.
- Repository typecheck/build/test, architecture/import boundary and package-export
  checks, installation/release verification and final container/browser checks.
  No gate is weakened or skipped to call the product complete.

All authorized independently achievable work is completed before handoff.
The feature branch contains one coherent implementation and explicit checkpoint
commits. Never push main or force-push. The user creates PRs manually from
/pull/new/<branch>. Production deployment is a separate action and production
data changes require a verified backup and forward migration.

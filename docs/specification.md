# Crossfire, fleetd and fleet specification

This is the canonical current product specification. Implementation and verification
must satisfy it as one coherent system. Work is greenfield: WCBUBWHB (What Can Be,
Unburdened By What Has Been), one implementation per capability, no compatibility
interfaces, aliases, hidden fallbacks or duplicated policy. A checkpoint is not
certification. Production data is never reset by these products.

Legacy support, backward compatibility and dual old/new paths are prohibited,
including temporary paths, unless the user explicitly authorizes a specific
exception. Replacements update every owned consumer and remove the superseded
implementation. Necessary forward data conversion preserves production state
without retaining old runtime models.

The following approved review records the baseline findings and design decisions.
The current contracts below, not its historical implementation-status statements,
are normative.
- [Listener architecture, 30-minute idle sleep and report publication proposal](proposals/20261005-listener-and-publication-architecture.md)

## 1. Products and source ownership

The repository contains exactly three product roots:

```text
services/
  crossfire/
    apps/server/
    apps/web/
    packages/
      agent-tools/assets/
    tests/
    scripts/
    tools/
    docs/
  fleetd/
    apps/daemon/
    packages/domain/
    packages/contracts/
    packages/storage/
    tests/
    tools/
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
There is one listener and one native integration per supported runtime, not per-product copies.
Only concrete, supported capabilities have packages. Every agent belongs to a
fleet managed by fleetd, including a one-agent fleet. There is no standalone
deployment, existing-session attachment, optional controller or detach-to-direct
operation. Runtime behavior remains behind pure adapter interfaces. Codex
0.158.0+ is the only implemented runtime; Claude Code and Pi are unimplemented,
not selectable alternatives, placeholders or retained legacy integrations.

All npm names use @ctlflow. Product names are @ctlflow/crossfire,
@ctlflow/fleetd and @ctlflow/fleet; internal modules consistently use
@ctlflow/<service>-<module>. Only fleet and fleetd are public distributables.
Every other workspace, including Crossfire and the repository workspace, remains
private. Public packages ship verified standalone builds with exact dependencies
and never require publishing internal modules. The reviewed implementation plan
is [Universal fleet controller](plans/20261005-universal-fleet-controller.md).

Crossfire and both public products share one exact package version. The setup
descriptor derives its pinned Fleet version from Crossfire's version; Fleet's
public fleetd dependency is an exact pin. The seven-day npm release-age policy
has only exact named product exclusions for `@ctlflow/fleet` and `@ctlflow/fleetd`
alongside the existing named Tinqer exclusions. No organization wildcard, private
package exemption, hook enablement or global age-policy disabling is allowed.
Controlled-registry gates verify those named positives and nonexempt negatives;
public installation cannot require publishing a private internal module.
The lock contains exactly the current owned workspace manifests and one link per
owner, with coordinated versions and matching dependency/engine maps. Removed
modules cannot remain as extraneous entries or alternate workspace owners.

First-party code, documentation and assets are proprietary under the root
LICENSE, copyright 2026 Jeswin P Kumar (jeswinpk@agilehead.com). Every workspace
declares the same author and `SEE LICENSE IN LICENSE` metadata and includes an
identical LICENSE. Public product archives include that license; standalone agent
tool documentation carries its complete text. Public npm availability grants no
open-source rights. Third-party licenses and notices remain unchanged, and
previously granted licenses for earlier versions are not retroactively revoked.

All four TOML dependency owners pin the same patched `smol-toml` 1.9.0 parser.
Dot-free key parsing must not repeatedly scan the remaining document. Existing
document-size bounds, strict schemas and native installation admission remain
unchanged; security updates do not authorize an age-policy bypass.
The single transitive `source-map-js` lock entry uses patched 1.2.2. Dependency
verification checks actual installed bytes against both parser locks and rejects
unsafe indexed-map offsets in a bounded subprocess. On 6 October 2026 the owner
explicitly approved a one-time release-age exception for resolving exactly this
security patch. Persistent npm policy and all other dependency admission remain
unchanged; no permanent exemption or direct dependency is added.

- Crossfire owns identity, enrollment, human authorization, room access, native
  reconciliation, wake policies, listener activity, fleet identity and React UI.
  Fleet membership alone confers no room permission, wake authority or new agent
  kind. Owner-reviewed role coordination settings use the same wake and
  generation-bound room-permission owners as every ordinary agent.
- fleetd owns user-scoped controller configuration, registered fleet directories,
  fleet execution operations, native runtime ownership, automatic resumption and
  assembling runtime/coordination/listener adapters.
- fleet owns commands, presentation and local/SSH connections to fleetd. It calls
  the daemon API even locally. It neither launches agent runtimes nor independently
  applies orchestration rules. A shared runtime terminal adapter prepares the
  interactive-client command for an already running daemon-owned session.
- Controller and fleet execution are ordinary user processes. No systemd unit,
  privileged service, machine-wide skill/configuration, global permission change,
  public controller port or external execution scheduler is installed.
- GAAP owns its deployment/Element theme and domain-specific fleet definitions.
  Burrow is outside this implementation.

Generic operator checks are service-owned `tools/` modules in this monorepo,
not GAAP scripts. Crossfire owns release/API/browser/database/host verification
and the exported operator support package. fleetd owns exact controller/binding
and adapter-dispatched native-history inspection. Preservation allows reviewed
appended instances while retaining every earlier account, exact context/session
binding and provider-file fingerprint; missing, changed or duplicate evidence fails.
Lifecycle remains in Fleet's existing CLI. Private expectations are explicit
inputs; checks neither call a model, answer native decisions nor create rooms.
Enrollment approval requires
explicit execution and an exact pending introduction. Fleet wake configuration
requires an exact owner/controller/complete roster plan and explicit execution.
It uses existing revision-checked per-agent wake-policy REST operations, preserves
room access and native sessions, verifies every resulting policy, and reports
partial or uncertain writes as failure rather than claiming fleet-atomic changes.
The operator guide records
coverage, bounds, historical script disposition and evidence limits.

Three product package manifests and their nested workspaces share one root npm
lockfile. Each product has coherent build/test commands. Named exports, strict
TypeScript without any, functional modules, Result for expected failures,
explicit .js relative imports, validated boundaries, and semantic splits near
600 lines are mandatory.

## 2. User experience and lifecycle

### Wake-ups

The management sidebar contains **Wake-ups** at `/manage/wake-ups`. Its searchable,
paginated table lists named rules, schedules, enabled state, assigned-agent count,
next due time and last receipt-confirmed delivery. `/manage/wake-ups/new` creates
a rule; `/manage/wake-ups/{ruleId}` edits its name, plain-text message, schedule,
enabled state and searchable/paginated agent assignments. Deletion requires human
confirmation. An agent can belong to several rules and a rule can target many
agents. Human owners see/manage their rules and may configure owned targets;
administrators see/manage every rule and may configure every target.

Schedules have one canonical tagged shape: `{kind: "interval", seconds}` or
`{kind: "cron", expression, timeZone}`. Intervals range from one second to
365 days and retain their cadence from the last save, even when a claim is late.
Calendar schedules use five fields (minute, hour, day of month, month, day of
week), explicit IANA time zones, lists, ranges and steps. Randomized fields,
seconds fields, implicit server time zones and impossible schedules are refused.
The UI offers weekdays/time controls and an advanced cron editor; both produce
the same calendar representation. `0 22 * * 3` with `Asia/Kolkata` means Wednesday
at 22:00 there; `0 1 * * 0,3,4` means Sunday, Wednesday and Thursday at 01:00.
The server's functional calendar adapter owns parsing and next-occurrence
calculation using pinned `cron-parser` 5.10.1. Neither the domain nor a runtime
implements another parser. Daylight-saving gaps advance to the valid shifted
hour (02:30 becomes 03:30 in a one-hour gap); repeated local times run once,
at their first occurrence. No OS cron job is installed.

The normalized `wake_rule`, `wake_rule_agent` and `wake_delivery` relations own
configuration, assignments/deadlines and session-bound publication receipts.
Revision checks prevent lost edits. Current configuring-human authority, rule
owner access, target/owner access, listener generation and any fleet delivery
gate are checked at admission. A rule grants no Matrix membership or tool
permission. Explicit schedules are independent of chat wake authority, including
an empty selected audience. Scheduling and reporting use ordinary code, never model polling.

The shared listener observes server-clock deadlines and publishes the configured
message as clearly identified scheduled input through the ordinary runtime
adapter. Busy targets wait without interrupting or delaying other targets.
Missed occurrences coalesce to one due delivery per rule/agent, not a backlog;
the next deadline lies after the current server time. At most one claimed input
per agent is pending, serializing several rules without coupling different agents.
Native publication is sequential and receipt-backed; exact session identity is
retained during retries. Receipt-only recovery never submits a new input.
Uncertain input is never silently retargeted to another native session.
Disabled, edited or deleted rules stop subsequent publication admission; already
accepted native input is not rolled back. Suspension, listener disconnection,
owner pause and inactive fleet/controller delivery gates remain authoritative.
No external scheduler, global service or additional daemon is installed.

Rules use human-authenticated REST CRUD at `/api/wake-rules` and
`/api/wake-rules/{ruleId}`. Agent-authenticated metadata, claim, validation and
receipt operations live under `/api/agents/{agentId}/wake-deliveries`; one
agent cannot acquire or acknowledge another agent's scheduled input. GET is
read-only. Production upgrades use the forward schema migration and a verified
backup, never a data reset.

Creation includes a caller UUID `ruleId`, `name`, `message`, `schedule`, `enabled`
and distinct `agentIds` (at most 1000). An identical creation retry is idempotent.
Updates replace the same complete configuration with `expectedRevision`;
deletion requires that revision as well. Names are bounded to 100 characters,
messages to 16 KiB. Each rule records its owner and current configuring human;
loss of that human's target configuration authority prevents future admission.
Listener claims bind a stable `deliveryId` to a reporting `runId` and opaque
native `sessionId`. An expired/stopped run's claim can transfer only to the same
session; a live competing run and a different session are refused. A local
queued/publishing/delivered checkpoint and the native receipt journal recover
uncertainty without submitting another input. Recovery precedes any new urgent,
fleet, release or chat input. Receipt acknowledgment occurs after native
publication, not after model work completes. Accepted work is never rolled back.
Client metadata checks are bounded to 30-second refreshes, server-clock due
deadlines and a one-second busy recheck; they cause no model turn.

### Noninteractive agent setup

The user pastes one sentence directing the existing coding assistant to a
personalized setup URL. That assistant runs the noninteractive `fleet setup`
command; it is not connected, adopted or imported into Crossfire. fleetd starts
a new managed agent with its own conversation. Existing coding sessions remain
untouched. Later managed starts resume exact saved histories by default.

The guide dynamically supplies the verified owner/server and pins the public npm
release. Setup uses private persisted defaults without configuration questions:
current project workspace, project-derived stable fleet/agent identifiers,
existing configured local controller or a new local controller, native model
defaults, danger-full-access/on-request with bypass disabled, shared history and
the instance-wide 30-minute idle policy. Explicit optional configuration uses the
same validated owners. Repeated setup reuses registrations/identities/history;
invalid or ambiguous authority fails with an actionable error rather than asking
a question, guessing identity or silently creating a replacement.

Setup checks prerequisites and reports official installation/native login steps
when needed. It installs the pinned CLI/controller privately, creates or reuses
the controller, submits enrollment, prints its exact approval link/code, waits
in ordinary code for owner authorization, and verifies actual listener/native
readiness. No install lifecycle script starts a process. Human approval remains
required and is not a configuration prompt. Setup creates no room or conversation
in Matrix and sends no dummy model prompt. Owner DMs remain lazy and protected.

The canonical guide is `GET /onboarding/setup?ownerMatrixId=MATRIX_ID`.
`GET /onboarding/setup.json` with the same exact query returns its strict machine
descriptor. Both require one valid, registered active human owner; absent,
duplicate or unknown fields and unsupported methods fail. Owner and server are
verified dynamically, never hardcoded to a deployment's administrator.

The descriptor is:

```json
{
  "schemaVersion": 1,
  "server": "https://example.test",
  "ownerMatrixId": "@member:example.test",
  "package": {"name": "@ctlflow/fleet", "version": "0.1.0"},
  "instructions": "The current instance administrator's agent instructions."
}
```

`server` is an exact HTTPS origin, except explicit loopback HTTP fixtures.
`package.version` is one exact supported npm version, not a range or tag.
`instructions` is bounded to 128 KiB. The CLI accepts only the fixed descriptor
path with one owner query, refuses redirects, and verifies response origin,
owner and version against that request and installed package. It neither
accepts credentials in the descriptor nor forwards secrets across origins.

The guide installs the pinned public CLI/controller into private user-owned
storage and invokes:

```sh
fleet setup --descriptor 'https://example.test/onboarding/setup.json?ownerMatrixId=%40member%3Aexample.test'
```

Optional `--config /absolute/runtime.toml` and `--root /absolute/controller`
select the same configuration and controller owners, not another setup mode.
The selected config must match the descriptor's server and owner. No configuration
is generated merely to repeat defaults. Setup records its exact private
operation and authority before submission; interrupted setup observes or retries
that operation instead of enrolling another identity. An explicitly stopped
previous setup returns Stopped and remains stopped until an explicit start.

`agent test` is an intentional tool over fleetd's existing private receiver.
It checks actual readiness, native authentication, active owner/agent access,
controller binding and applied/joined room grants without a model prompt,
dummy message, cursor advancement or conversation creation. An established
owner DM additionally requires both participants' native read/reply permissions.
A missing owner DM is a valid lazy state. Busy, sleeping, delivery-paused and
stopped are distinct; saved credentials or a controller process alone are not
proof of delivery. A missing receiver is an actionable error, never authority
to start a replacement listener.

### Fleet lifecycle

Noninteractive setup creates or reuses the user's private controller and its
persisted project-derived fleet. Explicit configuration may select a different
controller root, name or fleet directory through the same validated owner.
The root holds controller configuration and a registry of explicit fleet directories. Directories
may be under that root or elsewhere on the daemon's machine. There is no implicit
filesystem discovery. Each fleet directory is self-contained; runtime state and
Crossfire credentials travel with the stopped fleet directory.

The CLI supports:
- fleet setup --descriptor URL [--config ABSOLUTE_FILE] [--root DIR]
- fleet daemon start --name NAME --root DIR
- fleet daemon status --root DIR
- fleet daemon stop --root DIR
- fleet daemon restart --root DIR
- fleet remote add NAME --ssh USER@HOST --root DIR
- fleet --remote NAME list
- fleet add DIR; fleet list; fleet show KEY
- fleet test KEY
- fleet start KEY; fleet stop KEY; fleet remove KEY
- fleet update KEY [--release-directory ABSOLUTE_DIRECTORY]
- fleet agent list KEY
- fleet agent add KEY INSTANCE --definition DEFINITION
- fleet agent start KEY INSTANCE; fleet agent stop KEY INSTANCE
- fleet agent update KEY INSTANCE [--release-directory ABSOLUTE_DIRECTORY]
- fleet agent remove KEY INSTANCE
- fleet agent contexts KEY INSTANCE
- fleet agent attach KEY INSTANCE [--context EXISTING_CONTEXT]
- fleet activate KEY; fleet deactivate KEY
- fleet message KEY --text TEXT [--message-id UUID]

Local commands identify their controller root explicitly or through the selected
CLI connection profile. Remote paths refer to the daemon's computer. SSH uses
normal host-key verification and user authentication; connection profiles do not
disable checks or contain copied SSH secrets. The same API is reached through
a private Unix socket locally and SSH stream forwarding remotely.

Starting the daemon does not start a model turn. Closing the management CLI or
its SSH connection does not stop the daemon. An explicit stop operation stops
the addressed owned listeners and runtimes; stopping the daemon stops its fleets.
Removal decommissions the selected registration or instance without deleting
retained files, native histories or immutable Crossfire identities. Server-side
archive and retirement terminate operational authority; they never detach an
identity into another deployment mode. Native stop completion requires exact
controller evidence before the corresponding destructive coordination operation.

First fleet start:
1. Validate all definitions, native options, instructions, paths and unique names.
2. Check every name before runtime launch. A known collision refuses the whole
   start. A later atomic name-claim collision fails only its affected instance.
3. Submit the exact roster through shared enrollment. Display one approval URL
   and code for the human, and wait in code without model polling.
4. The owner approves the displayed identities, fleet connection and exact role
   wake/invitation settings. These apply automatically without another setup step.
   Room grants are a separate explicit human decision and start empty.
5. Privately exchange credentials and persist stable identity/session bindings.
6. Install the public package's verified private integration artifacts, start/resume each native
   runtime through the adapter and attach the shared listener automatically.

No agent is asked to discover ports, UUIDs, tokens, download releases, approve
itself, poll enrollment or report telemetry. Runtime connection metadata is passed
directly between code components, never copied through prompts. Codex receives
role/coordination instructions through the adapter's receipt-confirmed native
developer-instruction producer. Starting, enrollment,
connection, release verification, filtering, approvals and heartbeats make zero
model calls. An authorized task/message is what starts model work.

Later start reuses private Crossfire credentials, the same immutable identities,
native sessions and delivery positions automatically. Each native activation
refreshes provider authentication from the current authorized host login through
the runtime adapter; preflight does not rewrite a running engine's private login.
No resume flag or replacement
identity is invented. New agents need identity approval; changed/unapproved fleet
coordination settings need exact owner policy approval, even for existing agents. Invalid
credentials or failed native resume produces a concrete error, not a fresh session.
A second live owner of the same local instance is denied. Portable-directory
proof is explicitly outside this task; portability remains the storage contract.

Node's built-in SQLite exclusive transactions own each daemon, fleet directory
and receiver lifetime. OS-backed locks use private retained inodes, not expiring
leases. Suspension cannot create another owner; process exit releases ownership
without a stale-PID detector, external lock executable or deleting a lock inode.

Native settings (model, reasoning, sandbox, approval policy and cwd) are validated
and applied by the runtime adapter. Only stock Codex 0.158.0 or newer is supported.
Daemon orchestration contains no Codex-specific option translation. Native
authentication stays private and uses the user's authorized provider login.
The Codex adapter creates each instance state directory's private `.codex` home.
On first use it copies the authorized user's native provider/model configuration
and selected profile into that home. It never imports native
histories, workspace trust or approval bypasses from the coding session.
Every actual native start, resume, automatic wake and recovery atomically
refreshes the managed `auth.json` from the host's current private login in
`CODEX_HOME`, or `~/.codex` when unset. The host's currently signed-in provider
account is authoritative for that activation, including an intentional host
account change. Login refresh does not change Matrix identity, saved native
history, model/permission configuration or unread positions. The source is a
bounded private owned regular JSON file; invalid/unsafe input fails before native
startup without leaking credentials or retaining a stale-login fallback. An
absent source file removes the old file login; configured native environment
authentication remains native-owned. Preflight checks the current host login
without changing a managed engine's credentials. Configuration preparation,
history reset and read-only status/attachment do not recopy credentials. A
running engine uses its activation-time snapshot until its next native resume;
refresh is not a live account-switch operation. Optional workspace
configuration changes native cwd, not private identity/state ownership.
No controller credential enters model context.
Native thread creation and resumption receive validated model, reasoning and
permission configuration. Instructions use the separate canonical native producer
below, not a model-dependent configuration setting. Its durable developer item
materializes a zero-turn native history without a dummy user prompt or model call.
Normal stop closes the listener and owned Codex process. Abruptly killing fleetd
can leave the native app-server running; the native history's active-writer lock
then rejects another process attempting the same private home and session UUID.
This prevents a competing writer but does not establish automatic crash recovery.
Resume may remain blocked until that exact surviving process is stopped. A full
machine restart, where the old processes no longer exist, is a different case;
retained history still requires successful native resume. The audited stock
Codex protocol has no supported parent-lifetime control retaining its required
native remote TUI. This is an external native dependency limitation, not an
unimplemented Crossfire supervision capability.
No proxy, watchdog, process-name guess or orphan adoption substitutes for that
limitation. Descendant-process supervision and crash-proof cleanup are not
product guarantees.

### Fleet session controls

Management exposes controller-owned **Stop**, **Resume** and **Start with fresh
history** at fleet and per-agent scope. Ordinary UI/CLI start
always resumes the full saved native history, identity, configured parameters and
unread positions. Native response pagination/excluded turn payloads do not truncate
the runtime's own conversation context. First enrollment and an explicit reset
authorize primary-history initialization. Per-room mode creates a new history
when a room is first used; an explicitly configured history-mode change may open
its other primary context while retaining existing histories. An established
missing/broken binding fails rather than silently substituting a fresh session.

Fleet Stop saves the exact enabled-instance selection before disabling intent.
Fleet Resume restores that selection together with any currently enabled agents,
not all enrolled agents. Individual Stop removes its member from that selection;
an empty saved selection resumes nobody. Repeated Stop while already stopped
retains its original selection. Initial explicit fleet startup without prior
intent or a stopped selection starts the configured roster. Fresh-history reset
continues to use its explicitly confirmed fleet/agent scope, not the stopped set.

Fresh history requires explicit human confirmation in management and an explicit
`--fresh-history` flag on CLI start at either scope. It calls the controller's
single reset implementation and retains identity, permissions and Matrix data.
Both CLI scopes accept `--operation-id UUID` on start and stop for exact retries
after uncertain submission; the ID is printed before submission.
Native archived histories are not erased. Stop closes listeners and owned native
processes, not the controller; resume reconnects the same saved histories. It does
not freeze or resurrect an unfinished operating-system command. Delivery pause
remains a separate reversible gate and never creates or closes native histories.

Crossfire accepts revision-checked, idempotent fleet runtime-operation requests
from the fleet owner/administrator, at whole-fleet or exact bound-agent scope.
A normalized indexed `fleet_runtime_operation` relation owns the bounded pending
command and its controller receipt, not native execution. The authenticated live
controller consumes it through its existing control connection and invokes the
same durable native lifecycle owner used by the CLI. Lease renewal remains
independent of lengthy lifecycle work. A reconnect recovers the exact original
operation ID; uncertain or failed reset is never replayed as another operation.
Management reports pending/running/succeeded/failed outcomes, not speculative
success, and clearly distinguishes controller connectivity from native execution.
An observed terminal operation receipt refreshes the affected fleet agent list
and exact agent details, not only the fleet record; polling is not the
invalidation contract for a completed user action.
The initial claim rechecks current human account/permissions, bound target and
unchanged revision. It does not impersonate a login session or require the human
to remain logged in. Storage failures leave the command pending. A running claim
may move to a new authenticated lease generation with the same operation ID.
Native operations pin their completed outcome until the Crossfire receipt is
confirmed; ordinary operation-history pruning cannot discard that retry authority.

### Fleet controller connection and delivery

Every enrolled fleet has one authenticated live controller connection, maintained
by bounded HTTPS long polls, even when its listeners are deactivated or its native
instances are stopped. A fleet-scoped credential owns that connection; labels do
not authenticate it. A second live controller for the same fleet is refused.
Controller leases expire after 30 seconds. Each long poll lasts at most 10 seconds,
with a 15-second request deadline. Detected failure immediately closes the local
delivery gate; an undetected stalled connection is bounded by that deadline.
Reconnection obtains a fresh connection generation and current server intent.
The adapter retains its acquired or potentially acquired lease identity across
request failure, including a lost acquisition response. It releases that exact
generation when transport returns before acquiring a fresh generation; failed
cleanup cannot discard ownership or silently extend the
outage until lease expiry. Another controller's live generation remains protected.
Local shutdown always closes its delivery gate and listeners. Native lease release
is attempted independently; an unreachable server is not required for local exit
and an unconfirmed remote release remains bounded by the server's lease expiry.

fleetd embeds one shared listener host with independent per-agent bindings.
Every binding requires typed controller authority; there is no unbound listener.
Bindings use ordinary Crossfire/Matrix adapters for coordination and room reads
and admit input only while their exact authenticated controller lease is live
and the fleet's delivery intent is enabled. Connection loss, controller death or
deactivation closes the delivery gate without consuming unread positions.
Already accepted turns are not rolled back.

Each reporting run receives `controller: {fleetId, connectionId, credential}`.
The server verifies the private fleet credential, the exact current live lease,
the agent's immutable active fleet/instance membership, active owner/agent and
delivery intent before admission. A caller's controller boolean or fleet label
is never proof. Only fleet, connection and credential IDs are stored in the run;
the secret is absent from logs, audits, UI projections and model input.
An existing run cannot switch generations. Reconnection reports a new run with
its new exact lease; stale runs cannot publish runtime, decisions or scheduled
input as though their generation were live.

Owners and administrators can deactivate/reactivate the fleet in management;
the fleet CLI uses the same server intent through fleetd. Deactivation stops room
acquisition, model publication and activity reporting, not the controller or owned
native engines. Listener control connections and native sessions remain available.
Reactivation resumes those same listeners, sessions and unread positions, not
another enrollment or engine. Explicit controller-owned native session Stop
remains distinct from reversible fleet delivery deactivation.

An explicit fleet message is delivered through the controller and the shared
listener's serialized receipt path to the enrolled roster snapshot. This direct
input does not require room membership or room wake eligibility and does not
grant either. It carries verified human/controller provenance, never forged Matrix
events or administrator instructions. Only the fleet's owner/administrator or its
authenticated controller may submit it. An offline/deactivated fleet refuses new
messages. Stopped/unavailable instances are reported as skipped, never launched.
Messages have UUID idempotency keys, a 4096-character/16-KiB plain-text bound and
a ten-minute delivery lifetime. Each fleet accepts at most 32 pending messages;
history is SQL-paginated in pages of at most ten. Reusing an ID requires the same
fleet, author and body. Per-recipient publication/acknowledgment is durable and idempotent;
receipt uncertainty never becomes success or automatic resubmission under a new ID.
Failed/expired/skipped recipients and receipt-confirmed delivery remain distinct.
No model calls perform control, reconnection, fan-out, reporting or acknowledgment.

Incoming Matrix events are filtered and batched by ordinary code before model
delivery. The model chooses intentional replies/attachments through Crossfire's
messaging capability. Native terminal output is mirrored only to the private
owner DM under the owner-observation contract; it is never automatically sent to
a shared room or inferred destination.
Agent account, runtime state, reporting listener and applied room access remain
distinct observations. An agent with only its owner DM is not advertised as receiving shared-room tasks.

`fleet agent attach` prints a ready-to-run terminal command containing the exact
running-session endpoint, native session ID and workspace. It does not start an engine,
create/fork a session, enroll an agent, open a TUI or add a listener. The human
runs that command in their terminal. Stopped, starting, failed and stopping
instances cannot be attached. Closing the native TUI leaves the fleet, engine
and listener running. Explicit fleet/agent stop ends the owned engine.

The runtime port owns a private attachment descriptor with runtime, session ID,
workspace and bounded adapter-owned connection fields. Runtime session IDs remain
opaque bounded strings throughout daemon views; native format validation belongs
only to the runtime adapter. The Codex adapter supplies
its loopback endpoint, native home, executable/search path and the engine's private
token-file path. Its owner
produces it from the current live process, never from scans or guessed state.
Only the dedicated private attachment resource returns it. Ordinary fleet/agent
views, logs and Crossfire responses contain no connection fields.
No response or copied command contains the authentication token itself. The
command reads the existing 0600 token file into the native client's environment.
The TUI uses the instance's private native home, not machine-wide configuration.
Its native executable/search path comes from the running engine, so SSH attachment
does not depend on the remote shell initializing software such as NVM.
Engine stop removes that run-local file; restarting needs a fresh pointer, not
a descriptor persisted as restart authority.

Only composition roots select concrete runtime adapters. Native terminal
arguments, authentication and session selection live in
`services/crossfire/packages/adapter-codex`, reused through declared exports.
Each adapter declares approval ownership as `none`, `runtime` or `listener`.
Owned-runtime configuration validation reports that capability before enrollment;
live connections report the effective native policy after session selection.
Fleet orchestration consumes this capability without interpreting provider keys.
Listener-mediated approval uses the verified private owner DM automatically;
unknown native policy is a setup failure, never a no-approval default.
For remote fleets, the SSH adapter wraps the same native command so it runs on
the controller computer through the user's verified SSH connection. The engine
remains loopback-only; no public port or additional forwarding server is needed.

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
owners independently of fleet membership. Every operational agent has exactly one
authoritative active fleet-instance binding. Retirement retains that binding,
account and history but removes operational authority. An archived fleet has no
operational credential or live lease. Restoration requires a new exact owner
review and surviving private identity proof, not a name-based takeover.

Retirement accepts `{expectedRevision, instanceKey}` with the fleet's current
revision. Archive accepts `{expectedRevision}` through one resource used by
management and Fleet CLI. An authorized human or that fleet's authenticated
controller can archive; controller authorization additionally requires its current
live lease. Labels, public fleet IDs and another fleet's credential cannot grant
this authority. Both operations recheck every relevant
operation, native decision, scheduled delivery and fleet-message receipt before
mutation. The never-started exemption requires both no native observation and no
listener run; it cannot treat a missing receipt as proof of inactivity. Otherwise
the latest listener run must be stopped and have immutable actual native-close
evidence bound to its exact current live controller connection and credential.
The owner must remain active and the credential unrevoked. Sleeping, lost
contact, an earlier run's close or a stopped database reporting row alone is
insufficient. Renewed native observations invalidate prior proof. The server projects `Agent.canRetire`/
`Fleet.canArchive` and authorized `retire`/`archive` actions from these same
eligibility rules; a UI label cannot substitute for them. Current stop evidence
is a separate normalized receipt, not a second lifecycle owner.
Its `{connectionId, runId, receiptId}` binds immutable native-close evidence.
An identical valid retry is idempotent; a stale, invalidated or differently bound
receipt is a conflict, never a replacement generation's stop acknowledgment.

One initial owner approval issues a private fleet-scoped controller credential
alongside approved agent credentials. Its verifier is stored, never the secret.
The credential can read/update that fleet's reporting metadata, retire its exact
instances, archive its own fleet with the current live lease, and introduce new
enrollment requests for that fleet with proved identity material. Retirement and
archive still require the settled native proof and expected revision above. It cannot
approve enrollment, change roles/room permissions/wake policy, access other
fleets or impersonate a human Matrix login. Owner suspension/revocation disables
the credential. New agents still require explicit owner approval. Names and
public IDs alone cannot recover credentials or replace fleet authority.
The credential is controller-private, not model instructions. A fleet request may
include changed coordination settings, but only its human owner can approve them.
Authenticated identity/controller proof never substitutes for policy approval.

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
              +--> Schedule port --> calendar adapter

Fleet core --> runtime port -------> Codex adapter
           --> coordination port --> Crossfire adapter --> Crossfire API / Matrix
           --> local-state port ---> filesystem adapter
```

Only composition roots instantiate concrete adapters. Domain code imports no
HTTP framework, database driver, Tinqer expression, concrete adapter, UI type or
process launcher. An adapter implements a domain/core-owned port; it does not
define the application's authority rules.

Pure runtime decision/observation values are domain-owned. Contracts may import
only that pure value module and own wire validation/operation declarations;
domain code does not import contracts or validate HTTP payloads. The architecture
gate enforces this direction and the narrow declared export.

Fleet coordination policy values belong to the Crossfire domain; native listener
options and saved-context metadata belong to the shared runtime port. Fleet
contracts map the TOML/wire forms into those values. Domain modules import only
pure values or type-only core ports, never executable listener/transport modules.
The gate checks import declarations, dynamic imports and import-type expressions
against declared dependencies and semantic directions, including negative fixtures.

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
| Domain | Identity, role/permission evaluation, enrollment, name allocation, desired room access, invitation provenance, chat wake policy, scheduled Wake-up rules/claims, listener activity, notices, policy and audit intent. |
| SQLite adapter | One schema, integrity constraints, Tinqer repositories, row mapping, indexed queries, transactions and page-wide projections. |
| Matrix adapter | Native account, room, power, membership, media and event operations; map native facts/failures into domain ports. |
| Calendar adapter | Validate interval/calendar schedules and calculate the next occurrence through the domain's schedule port, with one pinned parser and explicit time-zone semantics. |
| Server | Configuration, composition, authentication boundary, routing and worker scheduling. |
| Fleet core | Roster validation, local work/state ownership, coordinated instance lifecycle and per-instance outcomes. |
| Runtime adapter | Validate native options, create/resume the exact session, expose its delivery/approval binding and receipt-only recovery, stop its owned connection/process. |
| Coordination adapter | Preflight, enrollment, approval waiting, credential exchange, exact live controller binding, release/activity and delivery-intent communication. |
| Shared listener core | One bounded acquisition/wake/batch/cursor/receipt/control path per instance; no native transport or model-driven housekeeping. |
| Filesystem adapter | Private instance state independent of optional native workspace, atomic files, owned local locks and validated paths. |
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
| POST /api/setup | Private local setup operation; verified descriptor, existing workspace and optional validated configuration produce/reuse the same fleet/controller state. |
| GET, POST /api/fleets | Paginated registry or register a validated explicit fleet directory. |
| GET, PATCH, DELETE /api/fleets/{fleetId} | Inspect/update registration or decommission it after exact native stop, retaining files/histories and archiving coordination authority. |
| GET /api/fleets/{fleetId}/readiness | Model-free diagnostic through desired agents' actual existing shared-host bindings; no controller/session start, cursor advancement or test message. |
| PUT /api/fleets/{fleetId}/delivery | Revision-checked activation/deactivation through Crossfire. |
| POST /api/fleets/{fleetId}/messages | Submit an idempotent direct fleet message through Crossfire. |
| GET, POST /api/fleets/{fleetId}/agents | List or add an instance using a validated existing definition. |
| GET, PATCH, DELETE /api/fleets/{fleetId}/agents/{instanceKey} | Inspect/update configuration or decommission the exact instance after native stop and coordination retirement; retain its identity/history. |
| GET /api/fleets/{fleetId}/agents/{instanceKey}/contexts | Existing shared/control/room histories and observed native state; no new history or model turn. |
| GET /api/fleets/{fleetId}/agents/{instanceKey}/attachment | Private exact running-session pointer; optional `context` selects an existing history, never creates one. |
| POST /api/operations | Idempotent start/stop/reset/update for a fleet or instance, or daemon shutdown. Update consumes the explicit installed verified local release directory, never HTTP discovery. |
| GET /api/operations/{operationId} | Observe accepted/running/awaiting-approval/succeeded/failed results. |

Operation creation accepts a client-generated UUID idempotency key, a typed target,
action and expected configuration revision. Reusing the key with different input
fails. Accepted does not mean running. Per-instance failures are preserved while
successful peers remain truthful. The daemon serializes conflicting operations
for the same fleet, bounds retained operation history and prevents duplicate
runtime/listener owners. Fleet state is derived from actual instance state, not
a second writable execution model. The CLI waits by API observation, not model use.
Only owned process handles may be signalled; no process-name scanning/killing.

Transient listener/native failures close the exact failed process generation before
bounded automatic recovery, with exponential delays from one to sixty seconds.
Codex's owned launcher and native engine share one dedicated process group.
Shutdown signals that exact group, not process names or the coordinating shell,
and escalates after a three-second grace period while awaiting confirmed pipe/process
closure. A launcher exit alone cannot prove its active native child stopped.
Recovery retains the deployed configuration, account, native histories and receipts;
it uses installed software, never installs a new release or discards uncertain input.
Permanent authorization/configuration failures require operator action. Explicit
session stop or retirement cancels recovery; cleanup failure
prevents an unsafe replacement process. Intentional listener stops are distinct
from crashes at the shared lifecycle boundary and cannot be silently restarted.
Failure and recovery remain visible through the existing management incident path.
Transport AbortError/TimeoutError and Node cancellation/network codes are transient
only while desired intent remains active. They do not imply an owner stop. Unknown
coded authorization, configuration, filesystem or protocol failures remain permanent;
cleanup must still finish before any replacement. The controller and native
lifecycle share this classification rather than independently guessing from messages.

### Binding lifetime, native sleep and durable intent

fleetd is the fleet's listening process. It embeds the shared listener core,
with independent authorized agent bindings and one shared
private loopback control server. There is no second fleet listener subprocess.
If every native session is sleeping, one fleetd application process remains;
this is not a promise about unrelated host/container/tool processes.

Agent credentials, Matrix cursors, permissions and receipts remain independent.
Consolidation never introduces a service-account inbox or shared authorization.
Every enabled binding independently watches Matrix. Idle long polls never occupy
ordinary work permits. One host budget fairly limits ordinary acquisition to 16
concurrent operations, ordinary publication to eight and native startup to four;
each queue is bounded to 10,000 waiters and is abortable. Ordinary acquisition
deadlines include queue admission. Accepted mention steering preempts ordinary
work and bypasses its permits and collection window. Cold native wake requests
use immediate bounded startup admission: unavailable capacity fails visibly,
without joining the ordinary queue, exceeding its limit or losing unread input.
An existing resume or native shutdown likewise reports immediate non-acceptance
instead of admitting a competing owner or waiting behind that lifecycle operation.
Empty recovery/housekeeping does not acquire work permits.
Invitation reconciliation and blocked-mention publication run as preemptible
ordinary maintenance, never inside the live Matrix watch. Blocked notices retain
only exact room/event identities in a validated durable journal, bounded to
10,000 entries and 24 MiB. Native history queries, partial marker recovery and
controller message receipts honor the same operation cancellation scope.
Capacity or cancellation never acknowledges unread input.
Controller-generation cancellation also covers queued publication permits. Cancelled
work releases its permit, preserves its checkpoint and leaves the logical receiver
available for the next authorized generation.
Verified ordinary receipts may checkpoint while an empty watch reconciles
membership. Accepted steering closes ordinary admission until its captured-turn
control is settled, preventing a new ordinary wait from blocking replacement
input. Only completed or superseded controls are retired by ordinary checkpoints.

Instance policy `fleetIdleTimeoutSeconds` defaults to 1800 (30 minutes), permits
integer values 0–604800, and zero disables automatic sleep. Management presents
minutes. fleetd owns every supported native process. Heartbeats, policy/release checks, filtered
traffic and statistics do not count as model activity.

Sleep requires confirmed idle across every opened, initializing and retained
native history. Pending native decisions, listener input, startup/cleanup,
publication or receipt uncertainty veto sleep. Unknown native activity keeps
the process alive and reports an owner incident, not invented idle state.
The lifecycle rechecks activity after inspection and serializes cleanup against
incoming input. Eligible room/DM, scheduled or fleet input resumes one exact
saved native generation before using the normal receipt path. History is never
silently recreated, copied or retargeted; shared/per-room settings remain intact.

Native shutdown does not stop the stable receiver, credential, cursor, heartbeat
or controller connection. Sleeping/waking are native states, not listener
offline. Metadata and terminal GETs never wake a process; live attachment while
sleeping requires explicit Resume sessions. Maintenance notices wait for a live
native session rather than waking sleeping agents. Failed native generations
report their original cause and resume independently with bounded transient
backoff after verified cleanup. Unverified cleanup blocks replacement.
Empty receipt sets are checkpoint-only no-ops at the native lifecycle boundary:
an empty Matrix reconciliation can settle while sleeping without starting a process.
Nonempty receipt sets still require their exact available native generation.

Each reporting run captures one immutable controller tuple and delivery-generation
signal. Lease loss or a disabled gate ends that reporting lifetime, not desired
activation. Reactivation creates a new reporting run even if pause/resume coalesce
before the receiver loop observes them. Server admission loss requests controller
reconnection; it is never classified as an explicit owner stop. Old reporting
failures cannot cancel a replacement generation. Native stop receipts retain their
original tuple and cannot authorize retirement after lease replacement. Expired
proofs are not retried by the current-generation worker or presented as current
connection errors; explicit retirement still rejects that stale evidence.

The private controller `desired-intent.json` stores activation separately from
observed execution. Its key pairs are bounded to 100 fleets and 100 instances
per fleet, validated and written atomically before activation/stop. Explicit Stop
removes the selected intent before cleanup and stays stopped after restart.
Orderly daemon shutdown preserves intent while closing owned resources.
Starting the same daemon/root restores desired bindings from saved configuration
and exact native histories, initially without a native process where possible.
Restoration is bounded to four concurrent attempts with 30-second startup
observations. A late result is drained/closed, not allowed to overlap a retry.
Permanent errors retain failed intent and require operator action.

The controller's private `resume-selections.json` durably owns saved Stop targets,
bounded to 100 fleets and 100 instance keys per fleet. Fleet views expose the
nullable `resumeInstanceKeys`: null means no saved Stop selection, while an empty
list is an intentional empty selection. Explicit operations retire queued startup
restoration ownership before draining its already-started generations. Retired
results cannot start a competing native owner or overwrite replacement state.

Each agent's native lifecycle writes private, bounded `resume-work.json`
checkpoints through a storage port when a saved context is working or waiting
for an answer/approval. Idle completion removes its checkpoint. Repeated working
observations do not rewrite it. Shutdown retains exact context/session IDs,
checkpoint time and a stable message receipt; abrupt death retains the most
recent unfinished checkpoint. The next activation validates every saved context,
then delivers one restart/continue instruction to its exact native history,
recovering ambiguous delivery by receipt before retrying. The inserted continuation
message asks the agent to re-read applicable AGENTS.md files and follow their current
instructions before continuing authorized unfinished work. Continuation activation
waits for authenticated delivery policy, reporting and local tool/query readiness;
startup idle observations cannot erase a pending continuation. Initialization must
finish before incoming messages use that generation. Idle/sleeping contexts
receive no synthetic task. This owner-requested continuation is task steering,
not lifecycle accounting or a Matrix message. It confers no new permissions,
approves no pending decision, infers no room destination and never forwards
per-room history elsewhere. Fresh-history reset archives these checkpoints with
the superseded bindings. Receipt deduplication does not promise exactly-once
external model/tool effects; the instruction prohibits repeating completed work.

No host boot service is installed: after power failure the operator still starts
fleetd with its original root. History, credentials, desired intent and unread
state are durable; unrelated in-flight shell descendants are not frozen for
continuation. Manually stopped fleets are never automatically started.
GET inspection never accepts edited configuration or increments revisions;
an explicit revision-checked start/reset owns configuration application.

An explicit agent or fleet reset stops all selected owned execution before any
selected history is retired, then exports complete available
authorized Matrix history and nonsecret configuration into private files, verifies
their hashes and current authority, then retires the original local context/cursor
state and starts a fresh native history. The account, credentials, workarea and
current configured model/effort/sandbox/approval parameters remain unchanged.
Per-room high-water cursors are captured before fresh execution; the new history
receives the export manifest as native instructions, not a paid bootstrap turn.
Saved phase/operation identities make interrupted preparation retryable. Incomplete
or changed exports cannot replace a context. Normal recovery/start is not reset.
Only the controller can perform this operation on its exact owned instances.
Each instance's reset preparation/outcome remains independent: a failed export
cannot start that instance fresh, and successful peers retain truthful outcomes.
One receipt-pinned native operation per fleet plus unfinished operations and the
latest 400 unpinned outcomes bound the controller journal at 700 entries for 100
registered fleets. Receipt acknowledgment releases the pin; a newer verified
remote command also proves that the prior command's server receipt finalized.

## 6. Crossfire fleet REST API

| Resource | Contract |
| --- | --- |
| POST /api/enrollments/preflight | Shared bounded roster availability check. |
| POST /api/enrollments | Exact roster, proposed fleet/controller and private claim. |
| GET /api/enrollments/{enrollmentId} | Authorized human review of the exact request. |
| POST /api/enrollments/{enrollmentId}/decision | Owner decision; administrator may reject but not approve as another owner. |
| POST /api/enrollments/{enrollmentId}/exchange | Private request obtains status and ready credentials. |
| GET /api/fleets | SQL-paginated own/all authorized views including controller and activity summaries. |
| GET, PATCH /api/fleets/{fleetId} | Scoped read and revision-checked label/controller update. |
| POST /api/fleets/{fleetId}/archive | Authorized human or that fleet's authenticated current live controller performs the same expected-revision decommission after settled native-stop proof; retain identity/history, retire instances and revoke controller authority. |
| GET /api/fleets/{fleetId}/agents | Paginated ordinary agent projections. |
| GET /api/fleets/{fleetId}/statistics | Owner/admin read-only hourly traffic and optional native usage summaries; bounded time window and SQL pagination. |
| DELETE /api/fleets/{fleetId}/agents/{agentId} | Scoped revision-checked retirement of the exact instance/agent after confirmed native stop; no detach or identity deletion. |
| PUT /api/fleets/{fleetId}/agents/{agentId}/native-stop | Current fleet credential records `{connectionId, runId, receiptId}` only after actual owned native close and settled decisions/wake/message receipts; exact active membership, stopped run and live lease required. Exact immutable retry is idempotent. |
| PUT /api/fleets/{fleetId}/delivery | Owner/admin/controller changes delivery intent with expectedRevision. |
| PUT /api/fleets/{fleetId}/controller-connections/{connectionId} | Controller-only exclusive lease acquisition, renewal or closure. |
| GET /api/fleets/{fleetId}/control | Controller-only bounded long poll of intent, pending direct messages and at most one session operation, including while delivery is paused. |
| GET /api/fleets/{fleetId}/session-operations | Authorized paginated requested native-session outcomes. |
| POST /api/fleets/{fleetId}/session-operations | Human owner/admin revision-checked request; UUID `operationId`, nullable `agentId` (null means whole fleet), `action` start/stop/reset, `expectedRevision`, `confirmFreshHistory` true only for reset; returns 202 with the operation. |
| PUT /api/fleets/{fleetId}/session-operations/{operationId}/claim | Current controller-only lease claim/reclaim with `connectionId`; human authority and target are rechecked. |
| PUT /api/fleets/{fleetId}/session-operations/{operationId}/receipt | Claimed current controller generation reports succeeded/failed with nullable `errorMessage`; identical final receipt is idempotent. |
| GET, POST /api/fleets/{fleetId}/messages | Scoped paginated history or idempotent message creation. |
| PUT /api/fleets/{fleetId}/messages/{messageId}/deliveries/{agentId} | Controller-only exact recipient acknowledgment; no native launch. |
| POST /api/fleets/{fleetId}/runtime-incidents | Controller-only immutable failure episode for an associated agent/native session; durable deduplicated notification, no lifecycle mutation. |

Crossfire stores authorized lifecycle requests/receipts but never executes native
fleet processes or provides SSH, host-control or runtime-options routes. Its fleet
page shows members, named controller, approved identities,
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

[[instances]]
key = "ocr-east"
name = "ocr-east"
definition = "document-converter"
workarea = "agents/document-converter/workarea/ocr-east"

[instances.listener_options]
history_mode = "shared"

[[instances]]
key = "ocr-west"
name = "ocr-west"
definition = "document-converter"
workarea = "agents/document-converter/workarea/ocr-west"

[instances.listener_options]
history_mode = "per-room"
```

- `fleet` is stable within the authenticated owner.
- Each instance has a stable key, registered name, definition reference and
  distinct relative work area, which is its private state directory.
  An optional `workspace` absolute path selects an existing native working
  directory without relocating state or adopting its existing coding session.
- `definition` resolves to `agents/<definition>/agent.toml`.
- The coordination block is supplied once for the fleet. It has no password,
  access token, runtime endpoint or thread ID.
- Model, reasoning, sandbox and approval settings belong to the definition,
  not to instance overrides in the roster.
- Runtime-independent listener settings belong to each instance's optional
  `listener_options` table, not to native `runtime_options`. `history_mode` is
  `shared` by default or explicitly `per-room`. Instance-wide Crossfire policy owns
  incoming inline-message size, not the fleet roster. Invalid or unsupported settings fail preflight.
  Configuration changes apply at the next stopped-to-running transition, not
  silently to an already running agent.

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
sandbox_mode = "danger-full-access"
approval_policy = "on-request"

[coordination_options]
wake_mode = "selected"
permissions = ["room.agent.invite"]

[[coordination_options.wake_senders]]
matrix_user_id = "@owner:YOUR_SERVER"
include_agents = true
```

`name` is the definition's human-readable label, not an account name. Its
companion `AGENTS.md` supplies the shared role instructions through the native
runtime's instruction mechanism. Identity-specific context, where needed, is
generated deterministically rather than maintained as copied role documents.

`coordination_options` is a runtime-independent, strict role configuration. It
requires `wake_mode`, `permissions` and `wake_senders` when present. Omission
requests `selected` with the actual configured owner as one person-only entry
and no invitation permission. Modes are `selected`, `humans` and `everyone`.
Permissions are empty or exactly `room.agent.invite`. Each of up to 2000 unique
`wake_senders` entries supplies `matrix_user_id` and `include_agents`. Only a
human entry can include that person's currently owned active agents. Individual
agent entries require false. `humans` allows all active humans plus selected
entries; `everyone` requires an empty list. Empty `selected` wakes nobody;
owner and self are not implicit. Use `wake_senders = []` for an empty list.
Unknown fields/capabilities, duplicate IDs, invalid flags and old presets/flat
sender-ID fields are rejected. Active identity and ownership are checked at
request and approval and resolved afresh for listener delivery.
All instances inherit their definition's complete policy; no instance override,
native-option alias or per-fleet permission system exists.

fleetd includes the resolved policy in each enrollment item. Owner review covers
the exact complete roster and each requested policy, including existing identities.
Approval applies canonical wake settings and invitation defaults to current
ordinary grants and new admission generations without another management setup
step. It grants no room membership, native power or extra owner approval ability.
An invited target inherits its own independently approved defaults, not the
inviter's authority. Owner and management DMs receive no third-agent delegation.

Changed settings require a new owner review on stopped-to-running transition.
Unchanged approved settings resume automatically without overwriting manual
room-specific permission edits within the same generation. A fresh admission
applies the approved defaults again. A changed policy review explicitly authorizes
replacing defaults on existing ordinary grants. Management can adjust current
wake/room policies; a wake edit differing from the file requires a new review on
next start. Retirement removes operational authorization; retained grant and
wake records are historical state, not authority for a detached listener.

The runtime adapter owns the typed `runtime_options` schema and native settings
translation. Model/reasoning settings reach the headless native session directly.
Codex reasoning efforts are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`,
`max` and `ultra`, subject to the selected native model's actual support. Values
are passed unchanged; `max` neither aliases `xhigh` nor enables `ultra`'s native
automatic delegation. Unknown efforts fail boundary validation.
The roster's work area supplies native cwd unless its validated optional
`workspace` selects an existing directory. State remains in the private work area
in either case. Permission settings retain native
semantics; unsupported settings fail rather than being ignored or elevated.
Codex defaults to `sandbox_mode = "danger-full-access"` and
`approval_policy = "on-request"` when omitted. Both remain configurable.
`dangerously_bypass_approvals_and_sandbox = true` selects `danger-full-access`
and `never`, equivalent to the native Codex
`--dangerously-bypass-approvals-and-sandbox` flag. Conflicting explicit sandbox or
approval settings fail. The adapter sends native thread settings, not a TUI-only
app-server CLI flag. `false` leaves ordinary settings/defaults in effect. There is
no `yolo` alias. Provider restrictions remain authoritative. On the next stopped-to-running transition, the
definition's current model, reasoning and permissions apply to the same saved
session. No TUI resume permission flags or new identity are required. Editing
definition files does not silently reconfigure an already running engine.

Instances sharing a definition share native settings/instructions, not mutable
history. Different native settings require a different definition; per-instance
listener options do not. Secrets and
shell command strings are not part of these tracked files. Runtime transport,
authentication and process ownership remain controller-controlled.

Native Codex Default-mode structured questions use the optional
`[runtime_options.features] default_mode_request_user_input = true`. This
under-development native option requires the selected binary to expose that
capability in `codex features list`, checked before process startup. The baseline
stock Codex 0.158.0+ requirement still applies. It is not enabled globally, a collaboration-mode switch or a prose
question parser. Native blocking state/deadline remain authoritative. Native
question/answer continuation is proven on Linux with an inert provider; this is
not certification of paid models or macOS. Missing native capabilities fail
startup explicitly; no question feature is silently disabled or emulated.

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
`grants = []` removes its discretionary grants, preserving the permanent owner
DM if one exists. A room plan never creates an owner DM. The owner DM is not an editable room-plan grant. Unknown identities are errors, not
enrollment requests.

The selected fleet's immutable UUID plus `instance` resolve the immutable agent
ID; the TOML `fleet` key must match that selected fleet. An administrator can
therefore review identically named fleets belonging to different owners without
ambiguity. The human does not transcribe account UUIDs. This file contains no local
paths, native settings, commands or credentials. Wake policies and invitation
defaults come from separately owner-reviewed role coordination settings; management
can adjust current policy. They are not implied by room grants or stored in this plan.

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
          .crossfire/             identity, tool release and delivery state
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

Work areas are distinct and non-overlapping. Path validation prevents private
state escaping the chosen fleet directory. Optional native workspace references
must resolve to validated existing directories; references grant no controller
authority and establish no second state reader. Managed credentials remain in
private instance state. Private directories use mode 0700 and secret/state files
mode 0600, with atomic writes where interruption could corrupt bindings.
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

Changing a registered name follows this same enrollment pipeline, not a second
rename API. Private controller/native identity proof binds the immutable owner,
fleet key, instance key and agent UUID. Introduction reserves the proposed name
while retaining the current name; owner review displays `currentName` alongside
`requestedName`. Any changed name requires that active human owner's explicit
approval, even with unchanged coordination policy and valid saved credentials.
Captured principal revisions reject stale reviews; approval atomically replaces
the unique name and schedules native display-name reconciliation. Rejection or
expiry releases only the proposed claim. Old names are not aliases. Matrix IDs,
credentials, room grants, provenance and native histories stay intact. Exchange
rejects an old approved request whose name no longer matches the current identity.
An existing protected owner conversation follows a changed automatic title, but
a human-customized title is preserved; name reconciliation creates no chats.

`fleet enroll FLEET` invokes the same preflight/introduction/approval/exchange
for a stopped whole fleet without enabling delivery or starting/resetting sessions.
The private controller operation action is `enroll`; public native lifecycle
actions remain unchanged. Local profiles, cursor directories and messaging-tool
profile selectors are owned by immutable instance keys, never registered names.
An identity-checked forward storage migration uses an interruption-recoverable
journal and rejects active writers, target collisions or history merging. After
cutover only the immutable-key runtime path exists.

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
complete successful roster and its exact fleet coordination settings, including
authenticated existing identities. Changing the roster or policies invalidates
its review; a concurrent
collision is not permission to approve a different hidden subset.


All routes in this section are normative product contracts. Shared contract modules own request/response
validation, expected failures and bounded payloads.

| Route | Authority and effect |
| --- | --- |
| `POST /api/enrollments/preflight` | Bounded, rate-limited roster availability/capacity check. Existing-identity exemptions require its private authentication. No claims, credentials or runtime mutation. |
| `POST /api/enrollments` | Introduce the roster and fleet coordination policies with persisted private idempotency material. Return per-instance outcomes and one exact owner review for new identities or changed/unapproved policies. |
| `GET /api/enrollments` | Paginated human owner view; administrators can inspect all. No private claim material. |
| `GET /api/enrollments/{id}` | Human review of the exact roster, code, expiry, decision and per-instance provisioning status. |
| `POST /api/enrollments/{id}/decision` | The named owner approves or rejects the reviewed roster and policies. Recheck captured existing-agent revisions and selected senders; apply all successful identities/settings atomically. An administrator may reject another owner's request, not approve it. |
| `POST /api/enrollments/{id}/exchange` | The initiating private claim obtains status and ready credentials during a bounded recovery lifetime. Credentials never appear in human/browser responses. |

Enrollment receives coordination information: owner, fleet, instance keys,
registered names, reporting controller descriptor, per-item coordination policies
and private request/authentication material. Every fleet item requires the complete
`coordinationPolicy: {wakeMode, senders: [{matrixUserId, includeAgents}], permissions}` shape, including
one-item fleets. Fleet/controller fields are mandatory; superseded payloads
without them are rejected. Read representations always include each item's
complete policy. Selected identities persist as normalized principal IDs.
It rejects definitions, model settings, work areas and local commands.

The controller persists its private idempotency key and claim secret before
submission. The server stores appropriate verifiers, not loggable credentials.
The same authenticated private request and identical roster returns the same
result; conflicting reuse fails. Exchange is repeatable within its bounded
lifetime so an interrupted local write does not create another identity. A correct
private claim past expiry can read only `expired` status, never native credentials
or controller authority. An incorrect claim remains unauthorized. fleetd checks
saved request status on an explicit start, replaces a terminal request with a
fresh reviewed request, and never retries owner rejection inside its wait loop.

A lost claim with no surviving private proof is not recoverable through public
roster lookup. Recovery must require the named owner's authenticated authority;
it cannot use a Matrix password requested by an agent.

Approval transactionally creates/reserves all reviewed successful new identities
with the reviewed fleet wake policy.
Fleet approval stores exact-owner defaults and materializes generation-bound
permissions using the ordinary room-access domain. Existing-agent revisions and
selected-sender access are rechecked before any identity, grouping or policy write;
expected failure rolls the entire decision back. Unchanged existing fleet policies
can resume without approval; per-room human edits are not compared or overwritten.
Active provisioning creates no conversations or
room grants. First private owner contact or a native permission request establishes
the protected owner DM through the canonical room-grant/application path.
Native account provisioning occurs
outside the SQLite transaction and can be pending or fail per instance. Retry
retains the same identity. The UI and controller expose that actual state.

Capacity counts identities, including reserved pending identities, rather than
counting a fleet as one account. Members use the configured per-owner allowance,
which defaults to ten agents. Administrators have no separate per-owner allowance
and use the instance-wide capacity, which defaults to one hundred agents. The
current normalized human role is resolved at preflight, claim and approval;
controller labels, request fields and the approving actor cannot substitute for
the intended owner's role. A role or policy change is rechecked at approval.
The same capacity calculation serves one-item and many-item fleet enrollment and is checked
transactionally at claim and approval. Instance capacity remains authoritative
for every role and includes the other owners' agents and pending reservations.
Twenty-instance approval must work when configured capacity permits twenty;
the controller never bypasses a configured limit or divides one approval into
hidden batches.

Request, roster, claim, parsing and response bounds are published and tested.
The selected bounds must support the twenty-instance acceptance flow, including
its room-plan review, without hidden request splitting. Policy rejection states
the actual limit and the required administrator action.

One-item and many-item fleets use the same name, issuance, capacity, provisioning
and audit owners. Every request has a fleet key, controller descriptor/private
claim and complete item policies. The same routes, request record, decision
transaction and per-item provisioning path serve all rosters.


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
visible. If native reply authority is lost, read-and-reply participation is removed
and reported failed, not silently applied as read-only access.

The shared listener acquires current native invitation metadata at activation and
at its reconciliation interval, with incremental membership changes prompting a
refresh. The Matrix adapter owns one bounded invitation-state reader: initial
metadata-only sync plus incremental catch-up, independently of the saved timeline
cursor. Reconnects, restarts and upgrades therefore recover existing pending
invitations without erasing or replaying timeline delivery positions. This runs
inside the existing controller-gated acquisition cycle, not a second receiver or
model prompt. The agent submits only the immutable room
ID to `POST /api/agents/{agentId}/room-invitation-acceptances`. Only that invited
agent can call the resource. The domain obtains the current native membership
event and its actual sender; supplied sender identities are not accepted.
Owners may invite their own agents, administrators any agent, and agents only
within their explicit room-scoped delegation and native invitation authority.
The same checks, ceilings, transaction and audit owner apply as for managed grants.

An authorized invitation creates a read-and-reply grant and its exact native
invitation event binds a fresh admission generation. The Matrix adapter accepts
that invitation without issuing a replacement invitation. Withdrawn/replaced
events cannot authorize admission. Removal retains the event receipt so observing
the same pending invite cannot undo removal. A genuinely new authorized invite
creates another generation; old delegation does not return. Denied invitations
do not stop unrelated listener delivery and retries are bounded. Admission never
changes wake policy, fleet delivery intent, identity or model permissions.

Each agent can establish one canonical private DM with its verified owner on
first use. Native Matrix integration adopts the exact verified owner-created
direct invitation, or reuses/creates a DM idempotently for actual terminal-visible
output or a native human-action request, and updates both participants' `m.direct`
account data.
No private conversation is required to enroll, start, reconnect, test or report
a listener. Existing conversation bindings are repaired, not replaced.
Generated conversations have a readable native name from the agent's verified
native profile; unnamed existing conversations receive that name without
overwriting human-supplied titles. Internal recovery aliases are not display
names. Only owner
and agent may be joined/invited; encryption, public join rules and world-readable
history are rejected. The normalized `agent_owner_conversation` relationship
identifies that room; the ordinary owner-authorized room grant/application owns
membership and read/reply access. No second receiver or permission owner exists.

This grant cannot be muted, downgraded, removed or delegated through single,
bulk or room-permission operations. It does not consume the discretionary room
allowance. Native reconciliation repairs membership and reply permission while
both accounts are active. Suspension/revocation still removes access. Controller
and listener disconnection and chat wake policy remain independent: empty selection and
selected-sender restrictions still apply to owner chat. Exact approval decisions
are handled independently of paused chat and wake eligibility.

Native creator authority is represented explicitly, never as a finite power level.
Element's trusted direct chats can make an invited agent an additional creator
in Matrix room version 12. Read-and-reply participation preserves that immutable
native authority without writing a creator into `m.room.power_levels`. Read-only
and custom-power restrictions are rejected before changing the grant; the UI
explains the native authority and offers mute or membership removal. The same
rule applies to every native creator, not just direct rooms.

Matrix clients such as Element own room creation, room configuration and human
membership management. Crossfire manages agents' participation in existing rooms;
room plans never create rooms. Native integration creates only an on-demand
private owner DM for native permission routing; other rooms must already exist. Agent bearer
credentials cannot apply a human bulk room plan.

Existing-room reads support the agent assignment editor and fleet plan review.
The directory contains the authenticated human's joined rooms and, with authorized
agent context, that agent's assigned room IDs. It is not a public-room directory
or administrator access to every private room. Native room metadata, stable IDs
and current authority are read from Matrix. Crossfire has no standalone room
directory, generic membership roster or human invite/remove UI. Agent grant
responses retain their observed native membership and power level.


### Required capability

An owner-approved fleet definition may supply `room.agent.invite` as a room
admission default. The room-access domain materializes it in the canonical
permission table for each authorized new ordinary-room generation. First/changed
policy approval also applies the reviewed default to current ordinary grants.
Authorization never unions a global fleet permission with room permissions.
Templates create no grant or native invitation. Current generation, provenance,
owner access and native Matrix ceilings remain mandatory. Private owner/management
bindings are established before application can expose delegation; a pending
owner DM does not gain permanent native repair authority until admission succeeds.

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

The intentional agent tool exposes `agent directory`, `room agent-access`,
`room invite-agent` and `room remove-agent`. The coordination adapter reads the
current grant and submits its exact revision/generation through the same REST
resource used by management. Native Matrix invitations are verified by the
receiving listener's coordination adapter and admitted through that same durable
permission operation.

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
- Native invitations must pass canonical target authorization before the
  receiving listener commits a grant and accepts them. Management does not claim
  a UI flag independently changes homeserver enforcement.
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

### Conversation history and routing

Shared context across people, rooms and DMs is the normal product model. Each
agent has its own history; agents do not automatically share histories with one
another. Every managed agent defaults to one shared native conversation, but
an instance may explicitly select `history_mode = "per-room"`.

Shared mode delivers eligible collected input across conversations into the
agent's one existing history. Per-room mode routes each immutable Matrix room ID,
including each DM, to a distinct persistent native conversation. Room renames,
aliases and leaving/rejoining do not replace that history. A new room ID is a
different conversation even if its display name matches. Separate histories are
not per-message resets, additional agent identities, another listener or extra
model calls for routing. Role instructions and configured native settings apply
to every conversation belonging to the agent.

In per-room mode an authorized message releases its own room's pending context,
not another room's non-waking trail. Ordering, debounce, byte batching and native
receipt recovery remain owned by the same shared receiver. Inputs and receipt
journals bind their exact conversation; no uncertain publication is moved to a
different history or resubmitted under another identity. Idle room histories
create no inference work. Non-chat operator, controller, scheduled and maintenance
input uses an explicit private control conversation, never the last active room.

Native conversation references are adapter-owned opaque IDs. Fleet configuration
and shared routing contain no Codex dispatch. One owned runtime may host multiple
native conversations; native support is validated before startup rather than
emulated. Private durable state preserves the exact mapping across restarts.
The terminal pointer can select an existing room conversation explicitly; its
default is the shared conversation or, in per-room mode, the private control
conversation. Attachment never creates or forks a history or guesses a session.

Changing modes takes effect only after the previous run's pending publication
has been resolved. Existing histories and unread positions are retained. New
per-room histories start fresh; shared history is not copied or forked into them.
Returning to shared mode resumes the retained shared conversation without
merging room histories. Previously delivered input is not replayed to seed a
different history. Native resume failure is explicit, not a fresh replacement.

History separation does not isolate files, tools, credentials or the native
process. Shared mode deliberately makes information from different conversations
available in one context. Neither mode grants permission to publish information
to a different audience. Room access and wake authority retain their separate
owners; typing destination never selects an output audience.

### Sender provenance

Each model-visible input contains `instance`, the verified receiving agent's
`owner` Matrix ID, native `events`, and a `senders` directory keyed by the exact
event sender Matrix ID. Each distinct sender appears once per emitted batch.
Registered humans have `{ kind: "human" }`; registered agents have
`{ kind: "agent", owner: "@verified-owner:server" }`; unregistered senders have
`{ kind: "unknown" }`. Human and unknown entries contain no agent owner field.
The model can compare an event's sender and its directory entry against the
envelope owner to distinguish the owner, the owner's agents and other senders.

Every event retains its exact sender, room ID, event ID and native timestamp.
Readable room/sender labels and explicit DM/room classification accompany the
verified origin when observable. Missing labels, ambiguous classification and
missing native timestamps are reported as unavailable, not guessed from text,
participant count or the listener's clock. Origin enrichment is batched by
distinct identity/conversation and accounted for in the publication byte budget.

Shared coordination instructions explicitly distinguish native terminal output
from chat replies: a response to room/DM input must use the messaging tool with
an explicit destination. Terminal text is an owner observation, not a room
reply. Source information is descriptive, never an elevated instruction or new
permission. Deliberate silence remains possible; no model retries or forced
acknowledgements compensate for a missing tool invocation.

The domain resolves kind and ownership from canonical indexed principal/agent
relations, never from display names, Matrix ID prefixes, message content or wake
authorization. Historical suspended/revoked senders retain their registered kind
and owner; this metadata grants no present wake authority or room permissions.
The coordination adapter uses authenticated `POST /api/principal-resolutions`
with 1–100 unique `matrixUserIds`. It returns one bounded
`{ matrixUserId, kind, ownerMatrixId }` entry for each requested ID; unknown IDs
are explicit and only registered agents have a non-null owner. The existing
`principal.read` permission owns this minimal identity projection. Credentials,
workspaces, runtime bindings and other private account details are absent.

The listener resolves only senders of events actually eligible for delivery,
after an authorized wake, using bounded bulk queries without model/tool calls.
Self-chat, automatic notices and idle/blocked traffic require no lookup. Missing,
substituted, duplicate, malformed or unavailable resolution fails before native
publication, with unread positions unchanged. The final byte budget includes
the directory, and split batches include only their own senders. Native event
identity/content, ordering, batching and receipt ownership remain unchanged.

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

Each authorized room retains its opaque native cursor. Reload reads only unseen
history after that checkpoint; timestamps describe origin, never substitute for
native continuation/receipt evidence. The default 100-record acquisition target is
soft: every authorized joined room can contribute at least ten available unseen
records, even when this exceeds 100 globally. Explicit smaller limits use a
one-record per-room floor. A fixed wake boundary and fair per-room quotas prevent
one busy room from displacing all others or extending collection indefinitely.
Fresh rooms receive a recent snapshot; acknowledged rooms resume forward.

Native HTTP response collection is a separate resource bound, not a model-input
budget. Valid oversized Matrix pages are retried with smaller native page limits
at the identical cursor. A single large event uses a finite 64 MiB collection
bound. Malformed data, a nonadvancing cursor and a resource-bound violation remain
explicit failures, without acknowledging omitted data. Transient acquisition
errors retry bounded reads without falsely disconnecting the controller lease.

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

Allowed wake authors are configured in management or approved fleet definitions:

| Policy | Wake authority |
| --- | --- |
| `selected` | Explicit person-only, person-plus-their-agents and individual-agent entries, combined with OR. Empty selection disables chat wake. Default is an explicit owner-only entry. |
| `humans` | All active registered humans plus explicit entries, including selected people's agents. No implicit owner-agent group. |
| `everyone` | All active registered humans and agents; requires no explicit entries. |

Selected-author configuration is a bounded relation of immutable principal IDs
and `includeAgents` flags, not display-name matching or a preset ordering. A
person entry includes that person; true also includes currently owned active
agents, including agents enrolled later. Individual-agent entries require false.
Two person groups admit both people and both ownership groups, not everyone.
The Rooms view shows a compact policy summary and selected-entry table. Its
picker is the durable `/manage/agents/{agentId}/wake` page with a back link,
search, paginated people/individual-agent discovery and a per-person scope
selector. Desktop and mobile use the same responsive page, not an overlay.
Draft entries remain visible across searches/pages. Cancel or Back discards them. Save
atomically replaces mode and all entries with an exact revision check. Conflicts
retain the draft, load the current policy and require explicit discard before
replacement. Empty selection wakes nobody. Owner is not implicit; self is excluded.
REST writes use `{expectedRevision, mode, senders: [{principalId, includeAgents}]}`;
reads return `{agentId, revision, mode, senders: [{identity, includeAgents}]}`.

The server resolves all modes through one wake-authorization owner. Suspended
or revoked identities and agents whose owners are inactive cannot wake listeners.
Renames do not retarget a selection. The listener receives the resolved allowed
authors and applies the same batching/receipt path for every mode. Search, save,
policy refresh and filtering involve no LLM calls. Changing modes is configuration,
not an additional receiver or an extra model prompt.

Non-waking messages remain eligible context. When an authorized message arrives,
the listener delivers accumulated ordered context together with the trigger in
one batch whenever it fits the configured bounds. Debouncing coalesces messages;
it does not turn a collected trail into one model call per event. File-backed
delivery preserves complete large context without inserting it into model input.

Crossfire instance policy owns `maxMessageBytes`, default 65536 UTF-8 bytes,
accepted range 4096–4194304. It applies equally to every agent binding.
The complete inline envelope counts, including origin, sender metadata and routing
instructions. If a single message or aggregate batch exceeds the threshold, the
shared listener writes complete content into owned private 0600 JSON files under
a 0700 directory and publishes one compact manifest pointer per selected history.
The manifest preserves room/DM origin, event/sender/time, verified sender
relationships, content byte counts and SHA-256 hashes. Staged content-only files
are explicitly distinguished from complete-event files. No truncation, automatic
file-to-context expansion or one-model-call-per-file behavior is allowed.
Controller broadcasts and scheduled wake-ups obey the same inline policy through
the shared private-file owner, retaining their configured origin rather than
manufacturing Matrix events. Their durable publication checkpoints retain exact
prepared input for receipt-only recovery, including accepted expired broadcasts.
Unconfirmed delivery and initial snapshot references remain pinned; after
settlement, files have 24-hour retention and hourly idle cleanup. Retired/orphaned
acquisition references also expire; pending content cannot be deleted by cleanup.
Native patches, terminal output, permission scopes and protocol frames do not
inherit this incoming chat threshold. Policy changes apply on refresh; confirmed
or uncertain publications retain their original receipt evidence.

`agent read` requests an explicit authorized unread catch-up globally or for one
room through the sole running receiver. The receiver serializes it against chat
acquisition/publication; the CLI acknowledges its exact query only after output
is written. Saved query/base checkpoints, a five-minute expiry for unacknowledged
queries and authority rechecks prevent concurrent progress, changed permissions
or lost output from consuming unread history. A begun acknowledgment remains
durable until its exact native markers settle, without replaying query output.
Expiry leaves positions unchanged. If no listener is
running, the command acquires the same receiver lock and uses the same query
implementation. No second receiver is introduced.

`agent history` browses available authorized native history globally or per room,
in either direction, using explicit per-room continuation entries. It never
advances unread checkpoints and remains separate from automatic wake eligibility.
File-backed output preserves continuations in the manifest. Agents may ask for
more history or catch-up intentionally, but must not model-poll for new work.

Room membership, role titles and invitation authority do not create wake
authority. A director-to-worker workflow needs an explicit compatible wake
policy. Selected meaningful room-state notices use the same receiver and
receipt path rather than a separate listener.

### Managed runtime adapters

fleetd composes the shared receiver, activity reporter, wake controls, artifact
installer and cursor owner with a runtime-owned native lifecycle adapter.
Codex is the only implementation. Claude Code and Pi values are rejected at
configuration boundaries; no selectable placeholder, extension, hook or retained
direct-session implementation exists. The architecture keeps pure runtime ports
so another concrete implementation must satisfy the same capabilities rather
than adding runtime dispatch to listener or fleet domain code.

Codex prerequisites are checked in ordinary code before enrollment/start:
supported stock version, configured provider authentication, selected native
features and private state/workspace safety. Linux and macOS use portable native
ownership/child-process mechanisms; Linux inert-provider evidence does not
certify macOS hardware or paid provider entitlements. Only the runtime adapter
interprets native model/provider settings.

Required `stateDirectory` owns private native home, history, receipts and
Crossfire identity/cursors. Required `workspace` is native tool cwd. They are
identical for a normal self-contained role instance unless explicit
`instances.workspace` selects another owned project. The native environment
supplies `CROSSFIRE_PROJECT=stateDirectory` and `CROSSFIRE_AGENT_NAME` to
intentional tools. Tools never infer private state from native cwd, adopt the
calling coding session, discover arbitrary processes or ask for a name.
An explicitly selected profile or the uniquely saved profile must be unambiguous.

First startup creates the managed native history; later startup resumes that
exact history. Initial instruction publication materializes zero-turn native
history without a dummy user message. No runtime-session import or history copying is
part of setup. Model, sandbox and approval use validated native configuration;
role/skill/admin instruction text uses the single receipt-confirmed developer
producer on creation, exact resumption and changed instruction revisions.

The Codex adapter's canonical `applyNativeInstructions` producer uses supported
`thread/inject_items` with an actual native message `role: "developer"` and
`content: [{type: "input_text", text}]`. It runs only against the exact idle owned
context before task publication and makes no turn/model call. Native generated-
schema capability inspection requires this actual method before enrollment/start;
unsupported binaries fail with an actionable prerequisite error. No additional
minimum-version claim substitutes for the selected binary's protocol capability.

A private durable instruction journal owns the stable content digest and exact
submission identity. Confirmation requires the matching native history path,
session, developer role, item ID and unchanged text. Lost responses recover from
that exact receipt before another append; unchanged confirmed revisions do not
append duplicates or rescan growing native history. Pending receipt recovery
streams the post-publication file snapshot once in bounded chunks with a bounded
record buffer; additional history growth is not an arbitrary whole-file size
failure. Changed role, skill or administrator text uses the same
producer and remains in retained native history across resume. Instruction
receipts do not acknowledge Matrix input or advance unread cursors. There is no
`developerInstructions`/settings-update fallback, spoofed user message,
model-dependent branch or direct rollout-file writer. Stock Codex 0.160 Linux
source proofs with Sol/max settings and an inert provider cover zero-model
creation, exact resume, changed instructions and receipt recovery. They do not
certify an installed release, macOS or paid-model behavior; the integration owner
must verify the produced artifacts and complete current native gates.

Shared bounded publication journals and native-file validation belong to
`adapter-runtime`; native transport, settings, history, permissions and terminal
pointers belong to `adapter-codex`. An exclusive native SQLite transaction owns
each session's publication journal for the connection lifetime. Another profile
cannot concurrently mutate it. Close or process death releases ownership while
uncertainty remains durable for exact receipt recovery, not a new submission.
Positive native busy/waiting state keeps pending input without a turn-duration
deadline or early receipt. An idle unconfirmed publication retains its finite
uncertainty deadline; native operation deadlines and connection closure remain
authoritative. Only the exact native receipt advances Matrix unread positions.

The model-free `agent test` checks fleetd's existing receiver, effective
authentication and exact native binding, including observed busy state. It
neither starts an engine nor treats saved credentials as readiness. Native turn
interruption is a typed capability, not assumed from a runtime name. Codex
supports captured-turn interruption. A fresh native Matrix mention by an eligible
verified human or agent acts like Esc followed by new input: capture the exact active
turn, confirm native interruption, then deliver the full attributed instruction
through the same receipt path and history ahead of unread backlog. Current wake
authors, native sender/agent membership, unmuted room access and controller
admission remain authoritative, including an empty selected audience. Human and
agent sources have identical steering authority when accepted by that binding.
Unknown/unaccepted sources, self-messages, display names, historical snapshots,
edits and automated notices cannot interrupt;
fresh explicitly mentioned replies can. Shared mode steers the shared history;
per-room mode targets only that room history. Idle/sleeping agents reuse their
saved history without an interruption or dummy turn. Revocation during capture
or before delivery prevents new admission. Steering never answers a native
question or permission request. No `!!`-prefixed redirect alias is retained.
The separate addressed owner `!!` pauses/interrupts until later owner input;
this administrative stop remains available independently of the wake audience.
Cancellation is not rollback. Stale control cannot cancel a replacement turn.
The protected owner DM receives attributed mention receipt, verified captured-turn
interruption or already-idle status, and exact native input acceptance, including
source room/event/sender, sent/received/stage timestamps and elapsed timings.
After restart, a stage without its original in-memory receipt time reports that
time and derived receipt latency as unknown, not a fabricated current timestamp.
Failures and superseded steering are explicit, not successful-delivery claims.
These notices use the durable owner outbox with deterministic event/stage
transactions. Recovery preserves original input identity/content and resolves
uncertain native receipts before admitting replacement input. It never cancels
a replacement turn, replays confirmed input or advances unread gaps.
Generated control, approval and blocked-wake notices use one explicit marker
and are excluded from wake evaluation and later model context. Ordinary unmarked
messages remain eligible.

Intentional agent commands remain separate from lifecycle ownership:
`agent status`, `agent test`, `agent read`, `agent history`, `agent directory`,
room invitation/removal, native Matrix operations and report publication. They
cannot enroll, connect, disconnect or launch listeners. Read/history uses the
sole active receiver; its absence is an error, not an offline receiver fallback.
Native read-marker mutation cannot race the controller's receiver ownership.

The immutable tool release has exactly four artifacts: `README.md`,
`SKILL.md`, `crossfire-client.mjs` and `matrix-spec-LICENSE.txt`.
One private `@ctlflow/crossfire-agent-tools/build` export generates and verifies
the same bytes for the Crossfire server and public fleetd package. Internal
modules stay private and bundled. The installed public package owns the pinned
local release directory; no HTTP controller installer, optional launcher,
extension module or machine-wide skill is part of installation.

Acceptance requires installed CLI/native tests with inert local providers:
zero-turn enrollment/start/resume, busy/idle input, exact receipts, lost-response
recovery, interruption, owner decisions, bounded history, private tool invocation
and explicit software update. Results certify their actual protocol/platform
only, not paid-model quality or every native subprocess capability.

### Native tool approvals

Ordinary native file-change/activity notifications are not permission requests.
They must not fail because of chat-derived scope, display or input limits.
Actual permission requests retain their complete native scope and exact choices.
Large review material uses the complete authenticated decision detail,
not truncated actionable scope. Native transport/resource safety remains
separate. Presentation or owner-channel failure denies/cancels only the affected
request through a supported native outcome, not an otherwise healthy listener.

The native runtime adapter decodes exact permission requests. The shared human-
decision path sends them only to the canonical private owner DM and accepts only
the verified owner's explicit matching native decision through authenticated
review. Permission requests and structured questions use that same decision
owner, not separate approval transports. No approval-room selection exists in
the CLI or fleet configuration.

Each affected listener validates active owner and agent access before advertising
readiness or creating an online reporting run. A missing conversation is a
normal on-demand state, not a setup error. For an established conversation it
also validates current applied, unmuted read/reply access, native membership of
both, and native message permissions of both. A validated native permission
request ensures the private channel under that request's deadline/cancellation,
then performs the same current-identity, privacy and power checks before posting.
Native room versions
with implicit creator authority use that authority. Pure Matrix state and power
parsing has one contract owner shared by management and listener authorization.

The owner DM contains only its owner and its bound agent. Crossfire rejects
admission of every other agent, including another agent of the same owner, at
authorization and transaction commit. Indexed storage constraints enforce the
same exclusivity. An agent's room picker excludes other agents' owner DMs;
direct requests cannot bypass that exclusion. No human or administrator can
delegate invitations or configure third-party access to this protected channel.

Approval responses are control input, not model input, and do not alter wake
policy or resume paused delivery. Silence, unrelated messages and another human's
reply do not approve. Failure to establish or authorize the private channel for
an actual request denies that request explicitly without terminating an otherwise
healthy listener or silently changing its native permission policy.

The permission hook returns `Result` for expected authorization, transport,
expiry and cancellation failures. The Codex adapter denies only the pending
command using an exact offered native denial or cancellation choice; it does
not terminate a healthy session for those failures. Invalid scope, invalid
decisions, duplicate requests, bounds violations and malformed native protocol
remain failures. Successful decisions are exact native choices; no general
chat, missing reply or error becomes approval.

Fleet runtime failure immediately makes listener activity false, preserves the
bounded actual abort cause and retains successful peers. An explicit restart
cannot race pending failure cleanup. A cleanup error is secondary to the
original cause, not a replacement diagnosis. Controller-owned transient recovery
uses the bounded, same-history lifecycle above for every managed instance.

Project privacy preserves subprocess errors such as `EPERM`, `ENOENT` and
`EACCES`, distinguishing them from genuine Git exit codes. Sandbox subprocess
capabilities belong to the native runtime; changing a single utility to another
spawn mechanism does not certify that general capability. Readiness without a
model turn verifies connection and authorization, not paid-model work or every
native tool execution path.

A user-selected native no-approval policy or explicit native bypass option is
a deliberate choice, not the default or model-authorized elevation. Managed Codex
defaults to full access with on-request approval. The independent coding session
performing setup retains its own settings; fleetd does not attach or import it.

### Runtime failures and management conversations

Prevent avoidable failures by validating and classifying native events at their
owner and returning expected failures without killing healthy execution.
Contain genuine process/protocol failures to the affected instance; preserve
successful peers, the original cause and saved native conversation identities.
No system can guarantee that a process or host never crashes. This contract
requires observable, actionable failure rather than silent agent disappearance.

Each human member has one canonical private management DM with the existing
Crossfire service identity, named **Crossfire**. It is separate from every agent's
owner DM and aggregates operational notices across that member's agents, fleets
and controllers. Establish it lazily on the first real notice or explicit human
request, not at signup, enrollment, fleet startup or heartbeat. Bind and reuse
the exact verified conversation; no per-fleet/controller notification rooms,
hash-named display titles or preemptive agent chats. Only the member and service
identity participate; notices are not published to shared rooms or models.
The room is not an agent assignment: discovery excludes it from every agent's
room picker, and canonical grant/permission/invitation operations reject all
agent admission. Indexed database guards enforce the same boundary, including
binding order; the management conversation's owner and room binding are immutable.

For fleet-managed execution the controller reports actual agent exits/failures
through its authenticated fleet-scoped coordination channel. Crossfire owns
durable incident state, authorization, deduplication and native management-DM
delivery using its existing service identity. The controller does not acquire
owner credentials, create a second Matrix listener or become a new chat agent.
Each notice identifies the affected agent/fleet, descriptive controller label,
observation time, safe original reason and an authenticated management link for
diagnosis/action. Agent terminal output and native questions/permissions remain
in that agent's separate owner DM.

Crossfire independently detects expired controller/listener liveness. A controller
that has died cannot report its own death. Lost contact is reported as unknown
execution state, not an invented confirmed crash. Every fleet, including a
one-agent fleet, uses the same management-incident owner. Intentional native
Stop, disabled fleet delivery,
ordinary idle and native decision waits are not unexpected crashes.

One incident episode produces one initial notice, with recovery or material state
change updates rather than repeated heartbeat alerts. Persist undelivered notices
and retry native delivery idempotently after recovery. Crossfire/Matrix unavailability
necessarily delays delivery; do not promise an immediate DM during a total outage.
Keep failure causes useful without exposing credentials or hidden protocol data.
Acknowledging a notice is not permission approval, model input or an automatic
restart. Preserve uncertain publications and pending native decisions; never
replay work, replace a saved conversation or silently restart an engine to hide
a fault. Diagnosis and explicit recovery remain available through management and
the existing fleet lifecycle/terminal APIs.

### Owner terminal observation and decisions

All visible non-thinking native terminal content is forwarded to the agent's
canonical private owner DM: assistant commentary/final answers, visible tool
results and stdout/stderr, progress, warnings, errors and requests for human
input. Native reasoning items, reasoning summaries and hidden thinking traces
are excluded by their native event types, not by text heuristics. Private
protocol credentials and hidden secret-entry values are not terminal content
and are never copied into DMs, links, URLs or logs.

The owner is an explicitly trusted recipient of this transcript, including
content derived from rooms the owner has not joined. Shared history can combine
information from several rooms; source-room membership is not a confidentiality
filter. Mirroring never forwards output to a shared room, guesses an audience
from the last delivered message or claims history isolation. The DM is created
on first real output/request if absent, not during enrollment, startup,
diagnostics or heartbeats.

Machine-specific paths and diagnostics are permitted in this verified private
owner DM. The shared agent skill prohibits incidental execution-machine disclosure
in any other DM or room, including private rooms and rooms containing the owner:
home/workspace paths, OS usernames, private hosts/IPs/ports, internal endpoints,
socket/token paths, process/session identifiers, environment dumps and connection
strings. Replies use workarea-relative paths, neutral temporary references or
authorized uploaded attachments. Agent-local references do not grant recipient
access. Generated reports, filenames, archive members, logs and metadata require
the same review before sharing. Intended public product URLs, native Matrix
identities and source citations remain intact. Private tool execution and exact
owner-facing review scope may retain absolute paths. Credentials and secret
answers remain protected everywhere. This is communication guidance, not a
guarantee of model compliance, an output scrubber or a confidentiality sandbox.

Native event identity and per-conversation sequencing own ordered, idempotent
mirroring. Streamed output may be coalesced and large output split into complete
native-sized literal messages; visible content is not silently discarded or capped
by the listener's incoming message budget. Terminal repaint bytes are not a
second transcript. Mirroring and control notices do not wake agents, re-enter
model context or form loops. It uses the existing owner-conversation authority,
native Matrix adapter and live listener/controller lifecycle, not another
receiver, transcript-inference model or Element fork.

The durable private owner-output journal has a 64 MiB resource budget. Exhaustion
fails explicitly, not by truncation or silent deletion. Exact encoded native
message size determines Unicode-safe chunks; Markdown/HTML expansion is not
applied to terminal text. Native protocol/review resource limits are independent
of ordinary chat input and the former approval-display cap.

The verified pre-idle journal schema requires an explicit offline operator
conversion before current-schema activation. Under exclusive controller/receiver
writer locks, exact enrolled profiles and every observation are validated; all
original journal bytes are durably backed up and verified before atomic writes.
The missing lastActivityAt/historyAvailable metadata becomes null, never invented
history or activity. Pending output, timestamps, identities, cursors, provider
files and native conversations remain intact. Interrupted per-file conversion
is safely repeatable; current files are no-ops and other schemas are refused.
The runtime accepts only the current schema, with no compatibility reader.
This source-checkout operator tool is not part of either public npm bundle.

Native permission requests and structured yes/no, multiple-choice or free-text
questions use one runtime-independent human-decision owner. Adapters decode and
answer supported native requests; the shared listener owns delivery/cancellation,
and Crossfire owns authenticated human review and normalized decision state.
An ordinary sentence resembling a question is not converted into a native
request. Agent instructions require the native structured question capability
when execution must wait for a human decision. Runtime support is explicit;
arbitrary interactive subprocess prompts and missing native capabilities are
not approximated with terminal scraping or text matching.

Each decision binds its immutable agent/owner, listener run, native connection
generation, conversation, turn and request identity. Only the currently active
owner may answer. The owner DM presents the exact question and offered choices,
with one Crossfire review link per choice. Opening a link is read-only; the
authenticated page submits an explicit CSRF-protected decision. GET requests,
link previews, crawlers and possession of a URL never approve or answer anything.
Free-text input uses the same authenticated decision page. Secret answers are
not echoed into Matrix, audit records or ordinary activity projections.

Selection returns the exact supported native response to the original pending
request, even when that question came from a different room history. It is not
an unrelated owner-DM model prompt, new turn or second answer path. A native
permission answer is control traffic; a structured question answer is the
runtime's own tool response. No model call parses, routes or acknowledges the
human selection. Resumed authorized model work remains normal native inference.

Decision state distinguishes `pending`, `answered`, `responded`, `cancelled` and
`expired`. Answered means recorded selection; Responded means the exact native
socket-write callback confirmed transmission, not execution. A native request-clear
notification alone must not claim successful model resumption. Native resolution,
turn completion/interruption, disconnection and owner/agent revocation retire
obsolete requests; stale links cannot answer a later request. Uncertain native
responses are surfaced, never replayed automatically under a new request ID.
No timeout, default/preselected option or missing owner reply grants consent.

Native question availability, blocking state and expiration are distinct
capabilities. Preflight and management expose the supported native mode/feature
configuration; no silent collaboration-mode switch or imitation question tool
is introduced. Preserve each request's native blocking/nonblocking state and
deadline. An outstanding nonblocking question is not proof that execution is
waiting. A request cleared by native execution cannot later accept an answer,
and silence never selects a default or approves an operation.

A native request may contain multiple questions. Review preserves their exact
identities and offered values and submits one complete native answer set, not
partial responses that accidentally resolve the entire request. Choice links
identify the request and question without granting authority or exposing secret
answers. Native resolution notifications can mean cancellation/cleanup as well
as an answer; they alone cannot certify that the selected answer was applied.

### Native activity and typing

Observed native activity distinguishes working, idle, waiting for approval,
waiting for an answer, sleeping, waking, failure and unavailable observation. A heartbeat means
only a connected reporting listener; it is not proof of model progress.
Pending questions/permissions remain visible to the owner while the runtime
waits. A busy runtime without a structured request is not declared to be waiting
for a decision merely because it has been quiet.

Nullable last native activity and history availability are observations, not
guessed effective settings. Agent/fleet directory native summaries are hydrated
in one page-wide query from each agent's latest reporting run. A sleeping agent
can still have an online listener. Offline/stale summaries are explicitly last
reported information. One unavailable/failed/waiting context remains visible
instead of being hidden by another idle context.

Typing is native Matrix ephemeral state, published only to the latest room/DM
whose chat was actually delivered to the agent. Filtered/unpublished traffic
does not select a destination. Responding starts one 30-second lease. A newly
delivered message clears the previous destination, moves the indicator and
starts a fresh window. Ongoing work alone never renews it. Completion,
interruption or disconnection clears it earlier; native expiry still bounds it
if the publisher dies. This rule is identical in shared/per-room history modes
and never changes explicit response destinations. Element's shared English
indicator says “is thinking …” or “are thinking …” through native translation
overrides, for agents and humans alike. No Element source modification or model
call is required for typing.

### Releases and listener activity

The installed public fleetd package contains a pinned immutable tool release.
First setup verifies its complete artifact sizes/hashes before activation.
Recovery, sleep/wake, reconnect and repeated setup reuse the installed release;
they do not fetch a current HTTP artifact or silently replace software.
An incompatible release fails with an actionable update requirement.

Ordinary code compares the reporting release with the server's current manifest.
A different release queues one maintenance notice per native session/release.
The shared receipt owner publishes its stable ID; private durable state prevents
repeated notices across restart. It consumes neither chat cursors nor chat counts.
Sleeping sessions are not woken for maintenance. Pause and native uncertainty
retain the same publication authority.

The notice asks the human for update consent. After installing the pinned public
package into private storage, the human uses its newly installed executable for
`fleet update FLEET` or `fleet agent update FLEET INSTANCE`, then explicitly
runs `fleet daemon restart` with the selected private root.
Controller update verifies local bundled artifacts, stops/switches the selected
execution and resumes only previously desired-active targets with their exact
saved histories. Explicitly stopped targets remain stopped. Changed skill content
is applied through the same receipt-confirmed native developer-instruction
producer, including when resuming an existing history. Identity, grants, unread positions,
pending receipts and stop intent are preserved; no new identity or competing
receiver is created. Detection, installation and reporting are model-free.
A refused restoration of changed fleet files preserves activation intent. An
explicit update validates and accepts reviewed current configuration, reconnects
through the same execution port, clears the obsolete restoration error and
resumes only prior desired bindings. CLI status is descriptive, not a duplicate
lifecycle validation owner; the controller validates every submitted operation.
Remote CLI update requires `--release-directory` naming already installed remote
assets, or the human runs the installed CLI on the controller host. There is no
HTTP fallback. Restart uses the new executable while preserving
desired activation, explicit stop intent and exact saved histories.

Each agent binding reports its release, run and ordinary-code heartbeat:
30-second heartbeats and offline after 90 seconds without contact. The exact
server-verified controller generation owns every live reporting run.
Management shows observed active time, receipt-confirmed counts and last seen.
Online means a reporting binding, not a model turn or native Matrix presence.
The shared listener remains online while owned native sessions sleep.

Native Stop/Resume, fleet delivery Pause/Resume and explicit confirmed Fresh
history are separate controller-owned operations. There is no individual
listener-disconnection API or client command.

### Fleet traffic and native usage summaries

The shared listener keeps bounded in-memory traffic counters, not event bodies or
an analytics database: at most 256 sender/room/type flows, 32 native sessions and
2048 recent event IDs for approximate deduplication. Self messages and internal
notices are excluded. Observed and receipt-delivered traffic, UTF-8 content bytes,
declared attachment bytes and largest content size are distinct measurements.
Messages seen by multiple agents count per recipient. Overflow is an explicit
dropped-sample count, not silent loss of chat data. Explicit acknowledged unread
catch-up counts delivery; historical browsing does not count new message delivery.

Optional typed native adapter hooks supply cumulative input, cached input, output,
reasoning output and total tokens. Cache-write measurements can be null. Adapters
may omit usage entirely; unsupported data remains unknown. Codex uses its native
`thread/tokenUsage/updated` event, not model answers or transcript parsing. The
first sample establishes a baseline; Crossfire computes later nonnegative deltas
against an agent/runtime/session checkpoint across listener restarts. Regressions
are discarded observably. Cached input and reasoning output are subsets, not
additional tokens. Provider spend is null unless a supported measurement exists;
no guessed pricing or billing claim is made.

About every five minutes, one immutable summary travels with the ordinary
heartbeat. The server acknowledges its exact run/sequence/digest; repeated batches
are idempotent and conflicting reuse is rejected. A statistics failure never
rolls back a successful heartbeat. On acknowledgment the listener releases that
batch; shutdown attempts a final flush. Process death may lose unsent approximate
statistics but cannot affect chat delivery or receipts. Persisted times are integer
UTC milliseconds, never process-relative uptime.

Crossfire owns indexed normalized hourly rollups, retained for thirty days and
pruned at most hourly on ingestion. The read-only fleet endpoint accepts `hours`
in 1, 24, 168 or 720 (default 24), canonical `page` and `pageSize` (default 20,
maximum 100); unknown/duplicate parameters fail. Only the fleet owner or an
administrator can read it. SQL aggregation and pagination supply fleet totals,
per-agent traffic/usage and sender-to-recipient flows without storing message
bodies. Management's fleet Activity traffic view supports period selection, explicit refresh,
paginated flows and clear unknown/approximate measurement labels. No realtime
analytics subscription, periodic model use or provider-billing polling exists.

### Public static reports

An enrolled active agent can publish a dedicated static directory through the
same typed intentional tool:
`report publish --directory DIRECTORY --title TITLE`. It stages a manifest,
streams bounded regular files through typed binary operations and explicitly
commits only the complete, verified bundle. There is no archive extraction,
server-side execution, extra daemon or model-based integrity workflow.

The owned runtime receives its immutable local profile separately from its
mutable display name. fleetd supplies the instance key as that required profile;
native tools receive it in CROSSFIRE_AGENT_NAME and private state in
CROSSFIRE_PROJECT. Display-name changes cannot select a different credential,
cursor, workspace or native history. Invalid/missing profiles fail before native
startup; there is no display-name alias or profile-discovery fallback.

The server supplies a 256-bit, 43-character base64url public key. Committed files
are served at the explicitly configured separate content origin under
`/<publicKey>/index.html` and relative asset paths. Anyone holding the link can
read them: public distribution requires explicit human authorization, not merely
permission to work in a private room. Updates create a new immutable publication.
The tool returns a public URL only after confirmed commit. Uncertain outcomes
retain the exact publication identity for inspection, not a guessed URL or blind
duplicate creation.

One report contains 1–512 files, at most 32 MiB total and 8 MiB per file, with a
root `index.html`. Relative ASCII paths are at most 240 characters and 100 per
component. Traversal, aliases, symlinks, hardlinks, special files, case-insensitive
duplicate paths and a file serving as a directory are rejected. Exact extension,
MIME, length and automatically computed SHA-256 integrity are verified. The
domain owns semantic manifest validation; wire contracts own strict structural
validation and import only pure domain values. The filesystem adapter owns
bounded enumeration, no-follow handles, streaming and durable file/directory
synchronization.

Staging expires after one hour. Aggregate reservations default to 1 GiB and
4096 reports instance-wide, 128 MiB and 128 reports per agent; at most eight
concurrent uploads, serialized per report. Explicit private configuration can
change these finite budgets. Declared bytes/counts remain reserved through
expiry or deletion until disk cleanup succeeds. Replacement/interrupted pending
copies have a verified payload bound of twice reserved bytes, not a claimed
literal disk ceiling; filesystem/database/WAL/backup overhead is additional.

Every content response carries `sandbox allow-scripts` without
`allow-same-origin`. HTML and directly opened SVG execute at an opaque origin;
local scripts/modules, CSS, images, fonts and data remain usable. No cookies,
authentication, Matrix proxy, management routes, credentialed CORS, directory
listing or service workers are available. Static GET/HEAD/OPTIONS uses public
asset CORS only. Main APIs reject content-host and null Origin requests. Main
and invitation cookies use canonical Secure, HttpOnly, host-only `__Host-`
names with Path=/; no old-name fallback exists. DNS, TLS and nginx remain site
owned. This protects application credentials, not confidential report content.

Humans list and inspect their agents' reports; administrators can inspect any.
Only the publishing agent can upload/commit its own staging. Owners/admins
delete with an expected revision. The database public-read fence commits before
file cleanup; in-progress reads recheck it before headers and each chunk. Failed
cleanup is bounded, retried and still charged. Already downloaded bytes cannot
be recalled. Reports management uses paginated tables and durable Overview/Files
URLs, with no embedded or executed report content. Creation, publication and
deletion are audited. Detailed configuration, REST payloads and browser guarantees
are in [Public static reports](../services/crossfire/docs/publications.md).

## 11. Normalized persistence and authorization

One canonical schema and permission catalog own current state. Fresh stores
initialize schema 14 directly. An inventoried deployed schema 13 advances to 14
transactionally after a verified backup. Versions 1–12, foreign stores and future
versions are refused without mutation; there is no historical migration ladder,
historical runtime reader or reset-on-error behavior.

The canonical schema has 63 singular tables. The forward migration preserves
immutable identities, native credentials and histories, room/access records,
receipt and usage history, publications, policy and audit. It converts agent,
pending/current enrollment and historical archive wake policies into explicit
selections without changing effective authority: owner becomes a person-only
entry; owner-agents becomes owner plus agents; nobody becomes empty selected;
humans retains its former owner-agent exception as an explicit owner group;
selected IDs retain false flags. Everyone remains everyone with an empty list.
Revisions and room/invitation grants do not change. Pending enrollment digests
are recomputed from their exact converted review snapshots so the same canonical
request resumes; other historical digests remain unchanged. All table replacement,
archive-guard restoration, digest conversion and foreign-key checks are atomic.
Failure restores the original schema, values and version.

Retained archives and their normalized item/policy/permission/sender/metadata
relations remain historical records, never operational approval authority.
Foreign keys retain original owner, decider, identity and permission attribution.
Update/delete triggers protect all six archive relations. These are immutable
historical data, not another enrollment reader, approval API or authority source.
Unbound identities are not invented into fleets, discarded or given live
authority. Normal directories and operational authentication require an active
nonretired binding in a nonarchived fleet. Restoration requires a newly
owner-reviewed fleet enrollment and surviving private identity proof.

Current enrollment requires fleet/controller fields and a complete coordination
policy for every item. Listener reporting uses fleet/connection/credential IDs;
activity, receipts and runtime/statistics history remain intact. Only stopped
historical runs may retain an all-null controller tuple. Every new run must prove
its exact active fleet instance and current live controller lease; database
guards prevent mutable-generation reassignment. No raw controller credential
enters a run, projection, log or model context.

Schema conversion checks foreign-key integrity before committing the new version.
Current SQL and domain code operate only on the resulting schema. Necessary data
conversion is not permission to preserve a second enrollment, authentication,
listener or deletion path. Source work, operator configuration and external
credentials remain intact; production resets are prohibited.

### Relational conventions

All application tables have singular snake_case names. Tables are
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
`listener.report.self`, `enrollment.approve.owned`,
`enrollment.reject.owned`, `enrollment.reject.any`,
`member.manage`, `policy.manage` and `audit.read.any`.
Scheduled input adds `wake-rule.read.owned`, `wake-rule.manage.owned`,
`wake-rule.read.any`, `wake-rule.manage.any` and `wake-delivery.receive.self`.
Owners have the owned rule permissions; administrators also have the any rule
permissions. Only the agent baseline role has self-delivery authority.
Native reporting adds `runtime.report.self` to the agent baseline. Humans have
`runtime.decision.answer.owned`; administrators gain no other-owner decision
authority. Controller failure reports use the existing exact fleet credential
boundary, not a human role or a controller-label permission.
The implemented operation catalog and permission catalog must cover each other
in an architecture test. A role permission does not erase ownership checks or
pretend an administrator approved enrollment as another owner.

Static reports add `publication.publish.self` to agents; owners have
`publication.read.owned` and `publication.delete.owned`. Administrators also have
`publication.read.any` and `publication.delete.any`. No agent publication-delete
permission or other-owner publishing authority exists.

There is no role column in `member` or `agent` alongside `principal_role`.
General identity views cannot read `agent_credential`. Narrow credential
repository methods serve issuance and native account operations only.

### Enrollment, names and fleet tables

| Table | Complete logical columns and keys |
| --- | --- |
| `enrollment_request` | `id PK`, `owner_id FK member`, `fleet_key`, `verification_code UQ`, `claim_hash`, `controller_name`, `controller_credential_hash`, `roster_digest`, `status`, `revision`, `created_at`, `expires_at`, `decided_by_member_id? FK member`, `decided_at?`. |
| `enrollment_item` | `request_id FK enrollment_request`, `instance_key`, `requested_name`, `outcome`, `agent_id? FK agent`, `failure_code?`; `PK(request_id, instance_key)`. |
| `enrollment_item_policy` | `request_id`, `instance_key`, `wake_mode`, `expected_agent_revision?`; composite PK/FK to `enrollment_item ON DELETE CASCADE`. Exact review snapshot and stale-existing-agent guard. |
| `enrollment_item_permission` | `request_id`, `instance_key`, `permission_code = room.agent.invite`, `grant_scope = agent_room`; composite PK; item-policy FK with cascade; catalog FK `(permission_code, grant_scope)`. |
| `enrollment_item_wake_sender` | `request_id`, `instance_key`, `sender_principal_id FK principal`, `include_agents` checked 0/1; composite PK; item-policy FK with cascade. Exact selected-author review rows. |
| `agent_name` | `name PK`, `request_id?`, `instance_key?`, `agent_id? UQ/FK agent`; pending-item composite FK; `UQ(request_id, instance_key)`. |
| `fleet` | `id UQ`, `owner_id FK member`, `fleet_key`, `label`, `controller_name`, `delivery_enabled`, `revision`, `created_at`, `updated_at`, `archived_at?`; `PK(owner_id, fleet_key)`. |
| `fleet_connection` | `fleet_id PK/FK fleet`, `connection_id UQ`, `credential_id FK fleet_credential`, `last_seen_at`, `expires_at`, `closed_at?`. One exclusive controller generation. |
| `fleet_runtime_operation` | `id PK`, `fleet_id FK fleet ON DELETE CASCADE`, `agent_id? FK agent`, `author_principal_id FK member`, `action` start/stop/reset, `expected_revision`, `status` pending/running/succeeded/failed, `created_at`, `completed_at?`, `error_message?`, `connection_id?`, `credential_id?`; composite credential/fleet FK, matching terminal/error/claim checks. One pending/running operation per fleet. |
| `fleet_message` | `id PK`, `fleet_id FK fleet`, `author_principal_id? FK member`, `author_credential_id? FK fleet_credential`, `body`, `created_at`, `expires_at`; exactly one author; `(fleet_id, created_at, id)` index. |
| `fleet_message_delivery` | `message_id FK fleet_message`, `agent_id FK agent`, `status`, `completed_at?`, `error_message?`; composite PK; status is pending/delivered/failed/skipped; `(status, message_id, agent_id)` index. |
| `fleet_controller_metadata` | `fleet_id FK fleet(id)`, `key`, `value`; `PK(fleet_id, key)`. |
| `fleet_credential` | `id PK`, `fleet_id FK fleet(id)`, `secret_hash`, `created_at`, `revoked_at?`; `UQ(id, fleet_id)`. Fleet-scoped authority, not a human login. |
| `enrollment_controller_metadata` | `enrollment_id FK enrollment_request`, `key`, `value`; `PK(enrollment_id, key)`. Exact approval snapshot. |
| `fleet_instance` | `owner_id`, `fleet_key`, `instance_key`, `agent_id UQ`, `retired_at?`; `PK(owner_id, fleet_key, instance_key)`; composite FKs to `fleet(owner_id, fleet_key)` and `agent(principal_id, owner_id)`. |
| `fleet_instance_policy` | `agent_id PK/FK fleet_instance(agent_id) ON DELETE CASCADE`, `approved_by_member_id FK member`, `approved_at`; composite FK `(agent_id, approved_by_member_id)` to `agent(principal_id, owner_id)` enforces exact owner. No duplicate wake mode/selection. |
| `fleet_instance_permission` | `agent_id`, `permission_code = room.agent.invite`, `grant_scope = agent_room`; composite PK; policy FK with cascade; catalog FK `(permission_code, grant_scope)`. Approved admission defaults, not effective room authorization. |
| `fleet_native_stop` | `agent_id FK agent`, `receipt_id`, `sequence` (>0), `fleet_id FK fleet`, `run_id`, `connection_id`, `credential_id`, `native_stopped_at`, `invalidated_at?`; `PK(agent_id, receipt_id)`, `UQ(agent_id, sequence)`; composite FKs `(run_id, agent_id)` to `listener_run` and `(credential_id, fleet_id)` to `fleet_credential`. Immutable idempotent native-close evidence, invalidated by renewed native observations; not inferred from heartbeat or sleeping state. |
| `enrollment_archive` | `controller_name?`, `controller_credential_hash?`, `fleet_key?`, `id PK`, `owner_id FK member`, `verification_code`, `claim_hash`, `roster_digest`, `status`, `revision`, `created_at`, `expires_at`, `decided_by_member_id? FK member`, `decided_at?`. Exact fourteen-field historical request; original lifecycle, revision, expiry and paired-decision constraints, with no operational authorization API. |
| `enrollment_archive_item` | `request_id FK enrollment_archive`, `instance_key`, `requested_name`, `outcome`, `agent_id? FK agent`, `failure_code?`; `PK(request_id, instance_key)`. Historical result/identity attribution; failed outcome requires failure code. |
| `enrollment_archive_policy` | `request_id`, `instance_key`, `wake_mode`, `expected_agent_revision?`; composite PK/FK to `enrollment_archive_item`. Closed wake-mode domain and nonnegative expected revision retain the exact reviewed policy, not an effective current policy. |
| `enrollment_archive_permission` | `request_id`, `instance_key`, `permission_code = room.agent.invite`, `grant_scope = agent_room`; `PK(request_id, instance_key, permission_code)`; composite item-policy FK and catalog FK `(permission_code, grant_scope)`. Historical requested authority only. |
| `enrollment_archive_wake_sender` | `request_id`, `instance_key`, `sender_principal_id FK principal`, `include_agents` checked 0/1; `PK(request_id, instance_key, sender_principal_id)`; composite FK to archive policy. Exact historical selections, not current wake eligibility. |
| `enrollment_archive_metadata` | `enrollment_id FK enrollment_archive`, `key`, `value`; `PK(enrollment_id, key)`. Exact historical controller metadata, never routing/authentication authority. |

All six enrollment archive relations have rejecting UPDATE/DELETE triggers.
Their restrictive foreign keys prevent erasing referenced identity/catalog
history. They are retained by the forward migration without any operational
archive read/write path, JSON policy bag or compatibility enrollment mode.

One item or many items use the same request/decision/provisioning pipeline.
`requested_name` is an immutable review snapshot. Only `agent_name` owns the
current registered name. A name row points either to the complete pending item
key or to an assigned agent, never both or neither. Fleet review hydrates all
requested policies, permissions and selected Matrix identities in three indexed,
request-wide queries, independent of roster or selection size. Empty requests
require only the policy lookup. There are no per-instance or per-sender review
queries.

A request's fleet key is a proposed input, not authority or a reservation of
another owner's fleet. `fleet` and `fleet_instance` are established with
authenticated existing identity proof or the owner's approval, not through
anonymous lookup/preflight. The composite owner FK prevents cross-owner fleet
bindings. Enrollment does not own host execution configuration. Public-safe
configured/effective runtime observations are reported separately for management;
private local paths, native credentials and connection secrets are not exposed
through those projections.

The shared observation publisher retains the last observed state/settings for
each exact native history. A new reporting run republishes those snapshots with
their original observation timestamps, including after fleet delivery pause and
resume without restarting an engine. No model turn, owner conversation, guessed
state or extra native subscription is needed. Coalescing cannot replace an
in-flight snapshot before its receipt; new observations remain queued behind it.

Expiry/rejection releases pending name claims. Assigned names and fleet
bindings survive request retention, suspension and revocation. Public keys
cannot retrieve credentials. Native provisioning observations are not another
enrollment decision state.

### Room permission and wake tables

| Table | Complete logical columns and keys |
| --- | --- |
| `agent_room_grant` | `agent_id FK agent`, `room_id`, `generation`, `authorizer_id FK principal`, `added_by_id FK principal`, `invitation_event_id?`, `admission_kind` (`managed` or `invitation`), `access_mode`, `power_level?`, `muted`, `revision`, `access_revision`, `updated_at`; `PK(agent_id, room_id)`; `UQ(agent_id, room_id, generation)`. |
| `agent_owner_conversation` | `agent_id PK`, `owner_id`, `room_id UQ`, `created_at`; composite FKs to `agent(principal_id, owner_id)` and `agent_room_grant(agent_id, room_id)`. Schema guards require permanent owner-authorized unmuted reply access and reject grant downgrade/deletion. |
| `agent_room_permission` | `agent_id`, `room_id`, `generation`, `permission_code`, `grant_scope = agent_room`, `granted_by_member_id FK member`, `granted_at`; `PK(agent_id, room_id, permission_code)`; composite FKs to the exact room-grant generation and `permission(code, grant_scope)`. |
| `room_grant_application` | `agent_id`, `room_id`, `observed_generation?`, `applied_revision?`, `applied_access_revision?`, `membership?`, `creator`, `power_level?`, `last_attempt_at?`, `last_success_at?`, `next_check_at`, `error_code?`, `error_message?`; composite PK/FK to `agent_room_grant(agent_id, room_id)`. Native creators have no finite power level. |
| `agent_wake_sender` | `agent_id FK agent`, `sender_principal_id FK principal`, `include_agents` checked 0/1; composite PK; self-selection rejected; only human selections can include their agents. |
| `wake_rule` | `id PK`, `owner_id FK member`, `configured_by_id FK member`, `name`, `message`, `schedule_kind`, `interval_seconds?`, `cron_expression?`, `time_zone?`, `enabled`, `revision`, `created_at`, `updated_at`. A check requires exactly the interval or cron columns, never both. |
| `wake_rule_agent` | `rule_id FK wake_rule ON DELETE CASCADE`, `agent_id FK agent`, `next_due_at`, `last_delivered_at?`; `PK(rule_id, agent_id)`. One independent deadline/last receipt per target. |
| `wake_delivery` | `id PK`, `rule_id`, `agent_id`, `rule_revision`, `run_id FK listener_run`, `session_id`, `scheduled_at`, `created_at`, `status`, `delivered_at?`; composite FK to `wake_rule_agent ON DELETE CASCADE`. Status is pending/delivered/cancelled; only delivered has a receipt time. |

`agent_room_grant` is desired room access and addition provenance.
Its nullable native invitation event ID records the last admitted native invite,
not another permission source. It survives managed access edits and removal so an
old invitation cannot undo those decisions. The admission kind determines whether
the current intent requires that exact invitation or an explicit managed invite;
invitation admission requires a receipt. Existing managed grants have no receipt.
Stored grants and credentials are preserved by the transactional forward schema
migration; no runtime maintains another representation or resets production data.
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

Scheduled rules are explicit human-configured messages, not another chat sender
policy. Claims and deadline advances commit atomically; failed Results roll back
both. Editing a rule cancels pending claims and replaces assignments/deadlines
without fabricating a receipt. Removing an assignment/deleting a rule cascades
its delivery rows. A late exact native receipt can record work accepted before
cancellation; a removed delivery returns `recorded: false`. Rule summaries use
batched current assignments and their last recorded delivery, not model completion.

### Session, activity, policy and audit tables

| Table | Complete logical columns and keys |
| --- | --- |
| `member_invitation` | `id PK`, `created_by_member_id FK member`, `claim_hash`, `role_code`, `principal_kind = human`, `created_at`, `expires_at`, `consumed_by_member_id? FK member`, `revoked_at?`, `claim_matrix_user_id? UQ`, `claim_display_name?`, `claim_fingerprint?`; composite role-kind FK requires a human role. |
| `member_session` | `secret_hash PK`, `member_id FK member`, `csrf_secret`, `native_access_token`, `created_at`, `expires_at`. |
| `listener_run` | `id PK`, `agent_id FK agent`, `release?`, `controller_fleet_id? FK fleet`, `controller_connection_id?`, `controller_credential_id?`, `started_at`, `last_seen_at`, `active_ms`, `messages_delivered`, `stopped_at?`, `disconnect_requested_at?`; composite credential/fleet FK. The controller tuple is immutable and all-present on every new run; all-null is permitted only on stopped archived runs. No secret is stored here. |
| `wake_notice` | `receiver_agent_id FK agent`, `event_id`, `sender_matrix_id`, `room_id`, `reserved_at`, `message_body`, `status`, `sent_at?`, `native_event_id?`, `next_attempt_at?`, `last_error?`; `PK(receiver_agent_id, event_id)`. |
| `instance_policy` | `id PK = instance`, `revision`, `max_owner_agents`, `max_agents`, `max_pending`, `enrollment_seconds`, `reconcile_seconds`, `agent_instructions`, `signup_mode` (`invitation` or `open`), `invitation_issuers` (`administrators` or `members`), `max_message_bytes` (4096–4194304, default 65536), `fleet_idle_timeout_seconds` (0–604800, default 1800; zero disables). |
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
historical credential identifier is not a live FK: archiving a fleet cannot erase
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

### Statistics tables

| Table | Complete logical columns and keys |
| --- | --- |
| `listener_stat_checkpoint` | `run_id PK/FK listener_run`, `sequence`, `digest`, `captured_at`; retention index on captured time. |
| `listener_stat_interval` | `run_id FK listener_run`, `bucket_at`, `agent_id FK agent`, `started_at`, `ended_at`, `captured_at`, `dropped`; PK `(run_id,bucket_at)`, agent/captured/run/bucket read index and captured-time retention index. |
| `listener_stat_flow` | `run_id`, `bucket_at`, `room_id`, `sender_matrix_id`, `message_type`, `observed`, `delivered`, `content_bytes`, `delivered_bytes`, `attachment_bytes`, `largest_bytes`; PK `(run_id,bucket_at,room_id,sender_matrix_id,message_type)`, cascading composite FK to interval. |
| `listener_stat_usage` | `run_id`, `bucket_at`, `runtime`, `session_id`, `input`, `cached_input`, `cache_write_input?`, `output`, `reasoning_output`, `total`; PK `(run_id,bucket_at,runtime,session_id)`, cascading composite FK to interval. |
| `runtime_usage_checkpoint` | `agent_id FK agent`, `runtime`, `session_id`, `input`, `cached_input`, `cache_write_input?`, `output`, `reasoning_output`, `total`, `captured_at`; PK `(agent_id,runtime,session_id)`, captured-time retention index. |

These are summary measurements, not independent room authority or a duplicate
Matrix event store. External room/sender/session IDs retain their native identities.

### Runtime decision, observation and incident tables

| Table | Complete logical columns and keys |
| --- | --- |
| `runtime_decision` | `id PK`, `agent_id FK agent`, `run_id FK listener_run`, `runtime`, `session_id`, `request_id`, `turn_id`, `item_id`, `kind` (permission/question), `action`, `review_text`, `blocking`, `expires_at?`, `created_at`, `status` (pending/answered/responded/cancelled/expired); UQ `(run_id,session_id,request_id)`, composite FK `(run_id,agent_id)` to listener_run. |
| `runtime_decision_question` | `decision_id FK runtime_decision`, `question_id`, `position`, `title`, `prompt`, `secret`, `allow_text`; PK `(decision_id,question_id)`, UQ `(decision_id,position)`. |
| `runtime_decision_option` | `decision_id`, `question_id`, `option_id`, `position`, `label`, `description`; PK `(decision_id,question_id,option_id)`, UQ `(decision_id,question_id,position)`, composite FK to runtime_decision_question. |
| `runtime_decision_answer` | `decision_id`, `question_id`, `option_id?`, `answer_text?`; PK/FK `(decision_id,question_id)` to question, optional composite FK to offered option; exactly one option or text. |
| `runtime_observation` | `run_id`, `agent_id FK agent`, `session_id`, `room_id?`, `runtime`, `state` (idle/working/waiting-approval/waiting-answer/failed/unavailable/sleeping/waking), `observed_at`, `last_activity_at?`, `history_available?`, `history_mode`, `max_input_bytes`, `error_message?`; PK `(run_id,session_id)`, composite FK `(run_id,agent_id)` to listener_run. |
| `runtime_setting` | `run_id`, `session_id`, `name`, `configured_value?`, `effective_value?`; PK `(run_id,session_id,name)`, composite FK to runtime_observation. |
| `runtime_incident` | `id PK`, `owner_id FK member`, `agent_id? FK agent`, `fleet_id? FK fleet`, `run_id? FK listener_run`, `session_id?`, `kind` (failure/contact), `message`, `created_at`, `recovered_at?`; exactly one agent or fleet target. |
| `incident_notification` | `incident_id FK runtime_incident`, `phase` (initial/recovery), `body`, `next_attempt_at`, `event_id?`; PK `(incident_id,phase)`. |
| `management_conversation` | `owner_id PK/FK member`, `room_id UQ`, `created_at`; native room has only the member and existing service account, named Crossfire. |

Questions/options/answers/settings are ordered indexed relations, never JSON
permission bags. Complete review text is descriptive native evidence, not a
serialized authority model. Answers are unavailable in human GET/list/audit
projections; only the original agent's pending native exchange reads them.
Receipt/cancellation/expiry removes answer rows, including secrets. Decisions
remain attributable historical evidence. GET computes stale/expired status
without writing; maintenance performs cleanup. Episode IDs are immutable even
when an active target/session episode already exists. Notification bodies and
native transaction identities are stable across retries. Recovery notices
cannot overtake undelivered initial notices.

### Publication tables

| Table | Complete logical columns and keys |
| --- | --- |
| `publication` | `id PK`, `agent_id FK agent`, `public_key UQ` (43-character base64url), `title`, `state` (staging/published/deleted), `revision`, `created_at`, `expires_at`, `published_at?`, `deleted_at?`, `cleaned_at?`, `total_bytes`, `file_count`. Visibility, immutable identity/manifest and complete-commit guards; cleaned implies deleted. |
| `publication_file` | `id PK`, `publication_id FK publication ON DELETE CASCADE`, `path`, `media_type`, `bytes`, `sha256`, `uploaded`; UQ `(publication_id,path COLLATE NOCASE)`. Indexed normalized manifest, immutable after commit. |

SQLite stores no report bodies. The private filesystem stores only opaque file
IDs beneath the publication ID; declared relative paths are metadata, never
server filesystem destinations. A deleted management record retains attribution
without retaining public access.

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
| `enrollment_archive` | `(owner_id, created_at, id)`, `(decided_by_member_id, id)` | Preserved owner/decider attribution and foreign-key lookups, never current operational approval. |
| `enrollment_archive_item` | `(agent_id, request_id, instance_key)` | Historical result-to-identity references. |
| `enrollment_archive_policy` | PK `(request_id, instance_key)` | Exact historical item-policy and composite foreign-key lookup. |
| `enrollment_archive_permission` | `(permission_code, grant_scope, request_id, instance_key)`; PK request/item prefix | Historical catalog foreign-key/reverse lookup and requested permission identity. |
| `enrollment_archive_wake_sender` | `(sender_principal_id, request_id, instance_key)`; PK request/item prefix | Historical principal reference and selected-author lookup. |
| `enrollment_archive_metadata` | PK `(enrollment_id, key)` | Preserved metadata and historical request foreign-key lookup. |
| `enrollment_item_policy` | composite PK `(request_id, instance_key)` | Exact reviewed item and policy FK prefix. |
| `enrollment_item_permission` | `(permission_code, grant_scope, request_id, instance_key)` | Catalog FK and reverse permission lookup; item-policy prefix covered by PK. |
| `enrollment_item_wake_sender` | `(sender_principal_id, request_id, instance_key)` | Selected-sender FK/reverse lookup; item-policy prefix covered by PK. |
| `fleet_instance_policy` | `(approved_by_member_id, agent_id)` | Exact-owner FK/lifecycle lookup; agent prefix covered by PK. |
| `fleet_instance_permission` | `(permission_code, grant_scope, agent_id)` | Catalog FK/reverse lookup; agent-policy prefix covered by PK. |
| `fleet_native_stop` | `(fleet_id, agent_id)`, `(run_id, agent_id)`, `(credential_id, fleet_id)` | Current retirement eligibility and exact run/credential FK lookups. |
| `fleet` | `(created_at, fleet_key)` | Global fleet list. Owner lists use the composite primary-key prefix. |
| `fleet_credential` | `(fleet_id, revoked_at)`; UQ `(id, fleet_id)` | Fleet credential lifecycle and exact fleet-scoped connection/message authority. |
| `fleet_runtime_operation` | partial UQ `(fleet_id)` for pending/running; `(fleet_id, created_at DESC, id DESC)`, `(agent_id, created_at DESC)`, `(author_principal_id)`, `(credential_id, fleet_id)` | Exclusive native-operation admission, stable paginated outcomes and target/author/credential FK lookups. |
| `fleet_message` | `(fleet_id, created_at DESC, id DESC)` | Stable fleet-scoped message history and bounded paging. |
| `fleet_message_delivery` | `(status, message_id, agent_id)` | Pending message selection and capacity; message-prefix PK covers roster receipts. |
| `agent_room_grant` | `(room_id, agent_id)`, `(authorizer_id, agent_id, room_id)`, `(added_by_id, agent_id, room_id)` | Room views, authority loss, provenance. |
| `agent_owner_conversation` | UQ `(room_id)`, `(owner_id, agent_id)` | Canonical private channel lookup and owner lifecycle. |
| `agent_room_permission` | `(permission_code, room_id, agent_id)`, `(granted_by_member_id, agent_id, room_id)` | Effective delegation and delegator lifecycle. |
| `room_grant_application` | `(next_check_at, agent_id, room_id)` | Bounded grant application. |
| `agent_wake_sender` | `(sender_principal_id, agent_id)` | Sender lifecycle invalidation. |
| `wake_rule` | `(owner_id, created_at DESC, id, name)`, `(created_at DESC, id, name)` | Scoped/global sorted pages and name-filter counts without loading message bodies. |
| `wake_rule_agent` | `(agent_id, next_due_at, rule_id)` | Indexed next deadline and due selection; rule-prefix PK covers batched assignment hydration. |
| `wake_delivery` | partial UQ `(agent_id)` for pending status; `(rule_id, created_at DESC, id)`, `(agent_id, created_at DESC, id)` | One pending claim per receiver and indexed receipt history. |
| `member_invitation` | `(created_at, id)`, `(expires_at, id)`, `(created_by_member_id, created_at DESC, id)` | Instance-wide administrator and scoped issuer listings/expiry. |
| `member_session` | `(member_id, expires_at)`, `(expires_at)` | Session limits/revocation/expiry. |
| `listener_run` | `(agent_id, last_seen_at DESC, id)`, `(agent_id, started_at DESC, id DESC)`; partial `(last_seen_at, agent_id, id)` and `(controller_fleet_id, controller_connection_id, agent_id)` for unstopped runs; UQ `(id,agent_id)` | History, latest-run contact, exact live controller generation and runtime FK binding. |
| `runtime_decision` | `(agent_id,created_at DESC,id)`, `(status,expires_at,run_id)` | Paginated summaries without full review hydration, expiry maintenance. |
| `runtime_observation` | `(agent_id,observed_at DESC,run_id)`, `(run_id,state)` | Latest run/all native contexts and batched directory summaries. |
| `runtime_incident` | `(recovered_at,owner_id,created_at,id)`; partial UQ active `(agent_id,COALESCE(session_id,''),kind)` and `(fleet_id,kind)` | Episode selection/deduplication and recovery. |
| `incident_notification` | `(event_id,next_attempt_at,incident_id)` | Pending durable delivery. |
| `wake_notice` | `(receiver_agent_id, sender_matrix_id, reserved_at DESC)`; partial UQ on receiver/sender for unresolved status; `(status, next_attempt_at)` | Ten-minute cooldown and retry ownership. |
| `audit_event` | `(created_at DESC, id DESC)`, `(actor_principal_id, created_at DESC, id DESC)`, `(owner_id, created_at DESC, id DESC)`, `(target_kind, target_id, created_at DESC, id DESC)`, `(request_id, id)` | Global/scoped history and one operation's records. |
| `publication` | `(agent_id,created_at DESC,id DESC)`, `(created_at DESC,id DESC)`, `(state,cleaned_at,expires_at,id)`, `(cleaned_at,agent_id,total_bytes)` | Agent/global sorted pages, bounded expiry/cleanup and reserved storage. Owner scope seeks the existing agent owner index, not a parameterized administrator-OR-owner predicate. |
| `publication_file` | `(publication_id,uploaded,id)` | Bounded commit manifest; unique public path lookup uses its UQ index. |

Keys already cover the remaining table lookups. Permission/key prefixes are not
indexed twice merely for appearance. Role/permission reference data is small;
a generic cache is not part of this design.

Repositories execute filtering, ordering, counts and paging before hydration.
Owner-scoped queries do not contain a parameterized administrator-OR-owner
condition that prevents an owner seek. Distinct authorized scopes select
explicit query shapes inside one repository implementation. Activity summaries
are page-wide aggregate projections, never several queries per agent.

Activity reads use two indexed batch queries: historical totals and current
listener/controller admission facts. The domain evaluates the same pure predicate
used for single-run admission, including owner status, current instance/fleet,
delivery intent, exact connection/credential generation and unexpired open lease.
Missing joined facts fail closed. No authority lookup runs per listener.

Runtime observation hydration uses three constant queries for latest run,
contexts and settings, never one query per room. Contact detection selects
latest-started runs by indexed aggregate joins so an older abandoned run cannot
mark an agent offline after a newer run intentionally stopped. Decision pages
project summaries first; full native scope/questions load only for review.

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

Private controller and instance state is user-owned and atomic, separate from
an optional existing native workspace. Public availability checks
return no credentials or private workspaces. Enrollment claim proof and exact
roster/digest bind approval/exchange. Preview/apply binds the normalized plan and
expected revisions; a preview is not an authorization token.

Native provisioning and network calls occur outside SQLite transactions.
Reconciliation applies one desired-state model with finite concurrency, timeouts
and truthful pending/failure reporting. Each room has one serialized native
application owner within the Crossfire instance. Invitation acceptance and the
background worker use that same owner and read the latest grant after acquiring
it. Different rooms remain independent; power-map writes and membership cleanup
cannot race another application for the same room. Native calls remain outside
database transactions and revision checks still guard application commits.
No model call performs permission,
version, heartbeat, notice, filtering or lifecycle housekeeping.

The CLI uses ordinary user privileges and touches only selected project/fleet
state and its owned children. No global skill, privileged service, host permission
change or machine-wide configuration is part of this architecture. Logs and
public responses redact credential/claim material.


## 12. REST conventions and resource inventory

Crossfire exposes REST with JSON resource representations and explicitly typed
binary file-upload bodies. It does not add GraphQL. The canonical product
API prefix is `/api`; Matrix's native `/_matrix` endpoints, the personalized
`/onboarding/setup` guide/JSON descriptor and immutable tool release artifacts
under `/onboarding/<releaseId>/` retain their separate protocol/asset
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
| `GET /onboarding/setup`, `GET /onboarding/setup.json` | One required active human `ownerMatrixId`, verified native identity, trusted configured server and exact public package version; HTML instructions or canonical schema-version-one descriptor. No credentials or enrollment mutation. |
| `POST /api/sessions` | Human login; establish private cookie and CSRF state. |
| `GET, DELETE /api/sessions/current` | Read/end this human session. |
| `GET /api/principals` | Authorized, bounded identity discovery for wake selection and invitation targets; minimal directory projection. |
| `GET /api/agents/{agentId}/runtime-observations` | Public-safe native contexts/settings from the latest run, authorized agent/self/owner/admin read. |
| `PUT /api/agents/{agentId}/listener-runs/{runId}/runtime` | Exact live reporting agent/run, immutable session scope/configuration, public-setting allowlist and monotonic native observation. |
| `GET, POST /api/agents/{agentId}/runtime-decisions` | Paginated authorized summaries; creation only by the same active native reporting agent with exact run/session/turn/item/request. |
| `GET /api/agents/{agentId}/runtime-decisions/{decisionId}` | Complete authorized read-only review; contains no answer values. |
| `POST /api/agents/{agentId}/runtime-decisions/{decisionId}/answer` | Active verified owner explicitly submits all answers under browser authentication/CSRF. No other-owner administrator approval. |
| `GET /api/agents/{agentId}/runtime-decisions/{decisionId}/answer` | Same active reporting agent retrieves the original pending private native response; humans cannot read secret answers. |
| `PUT /api/agents/{agentId}/runtime-decisions/{decisionId}/receipt` | Same agent records responded/cancelled; exact live run and pending/native status required. |
| `POST /_matrix/client/v3/user_directory/search` | Native Matrix bearer-authenticated projection of the same authorized active registered-principal directory, without shared-room membership. Standard `results`/`limited` response; no room admission or grant. |
| `POST /api/principal-resolutions` | Authorized bulk resolution of exact Matrix sender IDs to registered kind and agent owner; unknown IDs are explicit. |
| `GET /api/roles`, `GET /api/permissions` | Read the fixed catalog, filtered by appropriate human/agent applicability. |
| `GET /api/members`, `GET, PATCH /api/members/{memberId}` | Authorized human directory/lifecycle management. |
| `PUT /api/members/{memberId}/role` | Explicit administrator assignment of one valid human role. |
| `POST, GET /api/member-invitations` | Eligible issuers create/list human signup invitations; member listings are issuer-scoped. |
| `GET, DELETE /api/member-invitations/{invitationId}` | Authorized review/revocation. |
| `POST /api/member-invitations/{invitationId}/claim` | Verify private invitation and establish a short-lived HttpOnly same-origin invitation capability for normal Element signup. |
| `GET /api/registration-policy` | Public signup mode for the login/onboarding experience. |
| `POST /api/enrollments/preflight` | Pure bounded roster/name/capacity check. |
| `POST, GET /api/enrollments` | Introduce one/many identities; list requests under owner/admin visibility. |
| `GET /api/enrollments/{enrollmentId}` | Exact reviewed roster and application outcomes. |
| `POST /api/enrollments/{enrollmentId}/decision` | Owner approves/rejects; administrator may reject others' requests. |
| `POST /api/enrollments/{enrollmentId}/exchange` | Private initiating claim obtains status/ready credentials. |
| `GET /api/fleets`, `GET, PATCH /api/fleets/{fleetId}`, `GET /api/fleets/{fleetId}/agents` | Authorized durable fleet/instance views and revision-checked metadata; not native process control. |
| `POST /api/fleets/{fleetId}/archive` | Authorized human or that fleet's authenticated current live controller uses the same expected-revision archive after settled native-stop proof; retires instances, closes the lease and revokes credentials, retaining histories/identities. |
| `DELETE /api/fleets/{fleetId}/agents/{agentId}` | Authorized exact `instanceKey` and `expectedRevision` retirement after native stop; no unbinding, reassignment or identity deletion. |
| `PUT /api/fleets/{fleetId}/agents/{agentId}/native-stop` | Current controller's exact live lease/run proof of actual native close, with settled receipts; records no guessed stop from heartbeat or idle state. |
| `GET /api/fleets/{fleetId}/map` | Human-authorized complete fleet topology: wake sources, agents, desired room access and last observed application. No controller access or mutation. |
| `GET /api/fleets/{fleetId}/statistics` | Fleet owner/admin hourly summaries, bounded period selection, SQL-paginated sender/recipient flows and optional native usage; approximate counts and unknown billing remain explicit. |
| `GET, POST /api/fleets/{fleetId}/session-operations`, `PUT /api/fleets/{fleetId}/session-operations/{operationId}/claim`, `PUT /api/fleets/{fleetId}/session-operations/{operationId}/receipt` | Human-authorized paginated session requests and controller-only generation-bound outcomes; Crossfire never launches native processes. |
| `GET /api/agents`, `GET, PATCH /api/agents/{agentId}` | Scoped list/details and configuration/lifecycle changes. |
| `GET, PUT /api/agents/{agentId}/wake-policy` | One complete mode and additive person/ownership-group/individual-agent selection configuration, with exact revision replacement. |
| `GET /api/agents/{agentId}/delivery-policy` | This authenticated agent's resolved native delivery policy. |
| `POST /api/agents/{agentId}/owner-conversation` | This authenticated agent ensures its canonical private owner DM; empty request, `{ roomId }` response. No caller-selected room or other-agent access. |
| `GET, POST /api/wake-rules` | Human owner/admin paginated rule list or idempotent named schedule creation; creation is CSRF protected. |
| `GET, PUT, DELETE /api/wake-rules/{ruleId}` | Scoped details, complete revision-checked configuration replacement or confirmed removal. |
| `GET, POST /api/agents/{agentId}/wake-deliveries` | Self-only read-only next-deadline metadata or atomic due claim. Both require the exact run/session binding. |
| `GET /api/agents/{agentId}/wake-deliveries/{deliveryId}` | Self-only current publication eligibility for an exact claimed run/session; no mutation. |
| `PUT /api/agents/{agentId}/wake-deliveries/{deliveryId}/receipt` | Self-only idempotent native publication receipt for that exact claim. No new input or fabricated model completion. |
| `GET /api/rooms`, `GET /api/rooms/{roomId}` | Authorized native room directory/details; optional agent context for the assignment editor. |
| `GET /api/agents/{agentId}/room-grants` | Desired grants with their observed application and allowed actions. |
| `GET, PUT, DELETE /api/agents/{agentId}/room-grants/{roomId}` | One shared owner/admin/delegated-agent access resource; removal rechecks addition provenance and generation. |
| `POST /api/agents/{agentId}/room-invitation-acceptances` | Receiving agent submits a room ID. Verify the current native invitation and actual inviter; apply the same canonical read-and-reply grant and confirm native admission. No self-assigned inviter or power level. |
| `GET, PUT /api/agents/{agentId}/room-grants/{roomId}/permissions` | Owner/admin reads/replaces this generation's complete scoped permission set. |
| `POST /api/room-grant-previews` | Validate/normalize a bulk plan and expose changes/digest/revisions; no mutation. |
| `POST /api/room-grant-changes` | Apply the exact confirmed plan atomically to desired state through the same grant domain. |
| `GET /api/agents/{agentId}/listener-runs` | Authorized run/version/activity history. |
| `PUT /api/agents/{agentId}/listener-runs/{runId}` | This active bound agent proves its exact live `{fleetId,connectionId,credential}` controller tuple; server persists only immutable IDs and owns time/accounting. Stale/replaced/closed leases are rejected. |
| `PUT /api/agents/{agentId}/wake-notices/{eventId}` | Idempotent model-free blocked-mention handling; verify original native event and current permission. |
| `GET, PATCH /api/instance-policy` | Read policy; administrator updates it, including instruction text. |
| `GET /api/audit-events` | Scoped, filtered and paginated immutable audit history. |
| `GET /api/releases/current` | Public current manifest/protocol requirements for deterministic installation/update checks. |
| `GET /api/health` | Bounded public readiness metadata without secrets. |
| `POST, GET /api/publications` | An active enrolled agent creates its own bounded staging; humans list authorized scoped/global report summaries. |
| `GET, DELETE /api/publications/{publicationId}` | Authorized read; expected-revision owner/admin deletion fences public access before cleanup. |
| `PUT /api/publications/{publicationId}/files/{fileId}` | Publishing agent's exact declared file, bounded binary application/octet-stream with exact Content-Length; no JSON/base64/multipart. |
| `PUT /api/publications/{publicationId}/commit` | Publishing agent commits a complete verified immutable bundle with expectedRevision; exact retry is idempotent. |

Single-agent, bulk and delegated-agent routes are transport representations of
the same grant domain, not competing implementations. Agent additions/removals
use the durable room-grant resources exclusively. Scope-changing routes must
declare their actor kinds and permission codes in the operation catalog.

The complete change includes server, management UI, CLI, runtime/coordination
adapters, npm/onboarding copy, released intentional tool bundles, routing/deployment
configuration, tests and documentation. All owned consumers use this contract.
Removed routes/payload forms are rejected; no aliases or compatibility handlers
are retained. Public API examples and generated clients use the actual canonical
paths and payloads, not a second documentation-only model.

## 13. Management experience

Element invite search uses Crossfire's registered identity directory. It does
not depend on an agent already sharing or joining a public room. Native tokens
are verified with Matrix before registered principal/owner status and
`principal.read` authorization. Management actors carry an explicit private
session proof; native actors carry the exact verified Matrix identity proof.
Native authentication does not replace browser cookie/CSRF requirements on
management REST routes. Unregistered, inactive and inactive-owner identities
cannot use this projection. Results contain only Matrix user IDs and display
names, with the same owner-qualified agent naming as management and native
profiles. Search requests accept only `search_term` (at most 200 characters)
and optional integer `limit` 0–100 (default 10); no URL token authentication,
unknown fields or hidden native-directory fallback. Errors use Matrix codes,
responses are not cached, and all other native Matrix endpoints retain their
normal native authority.

React management uses one outer page frame and shared paper-like layouts.
Within that frame, typography, aligned gutters, whitespace and light separators
establish hierarchy. Sections, filters, tables, result lists, empty states and
supporting notes have no enclosing decorative boxes. Borders remain on controls
and meaningful alerts; focus, status and destructive-action cues stay explicit.
Shared section headings use a muted flat tint and a narrow accent rule, with
consistent spacing between tasks.
Table cells vertically center their complete content group, including status
captions. Controls have no surrounding form margins; individual captioned lines
are not independently centered within the row.
Technical identifiers, provenance, connection metadata and longer explanations
are inspectable disclosures, not the default
information hierarchy. Permission ceilings, destructive effects, pending/failed
enforcement and the consequences of replacing access remain immediately visible.
Account, onboarding, directory, detail and administration screens follow the
same treatment at desktop and mobile widths. Copy names the resource, state or
action directly: no slogans, promotional eyebrows, filler headings or decorative
empty-state illustrations. Necessary permission, lifecycle and security
explanations remain visible.

Fleet list/detail and durable agent/room routes show names first, not opaque
IDs. Owners see their scope; administrators may filter all owners. Every agent
shows its fleet and named controller. Agent and fleet directories use compact
tables, not cards. Lists have status/search filters and pagination, except the
fleet directory: it displays the complete authorized filtered collection without
page controls, reading bounded 100-row REST pages. Counts and filters share API
scope; failures never masquerade as an empty or complete partial result. Refresh
does not imply an atomic multi-page snapshot.

Fleet detail has exactly five durable sections: Agents at the base path,
`/map`, `/sessions`, `/activity` and `/settings`. Agents opens on the roster
table. Sessions opens on scope-labelled Stop sessions, Resume sessions and
confirmed Start with fresh history controls. Ordinary resume uses exact saved histories. Requested,
running, succeeded and failed controller operation outcomes remain distinct;
no human HTTP acknowledgment is presented as native completion.
Controls track the latest operation independently of the selected history page.
The fleet controller's lease and delivery intent are labelled separately from
agent listener readiness and native execution.

A current, claimed controller lifecycle receipt records the final operation
outcome independently of listener generations. Historical stopped runs cannot
reject that outcome, keep Resume locked or force repeated native execution.
Reclaimed final outcomes release the local operation pin without execution.
Native-close retirement proofs retain their separate, exact current-run,
current-connection and credential checks; lifecycle completion cannot fabricate
those proofs or authorize retirement.

Latest-run summaries project Stopped from a successful scoped stop completion
after that run closed, or from a noninvalidated exact native-stop receipt. A
later reporting generation supersedes that projection. Agents cannot report
Stopped themselves. Offline observations without native-close evidence show
Unknown with muted last-reported state/time, never a current Working or Sleeping
badge. Saved-history availability remains separately reported, not inferred.

Fleet Activity groups delivery intent and broadcasts at `/activity`, and traffic/
usage at `/activity?view=traffic`. Pause delivery retains native processes and
bindings; it is not Stop sessions. The composer and paginated recipient outcomes
use the same scoped contracts as the CLI and never claim model completion.
Traffic uses bounded periods, SQL pagination, explicit refresh and asynchronous
summary evidence. Fleet Settings owns descriptive controller metadata, advanced
room-plan diff/review/application and confirmed archive. Archive requires
receipt-confirmed native stop and retains historical identities/data; it cannot
make agents independent or authorize another owner's approval.

Agent detail has exactly four durable sections: Rooms at the base path,
`/session`, `/activity` and `/settings`. Rooms groups current room access,
native enforcement and clearly separate wake eligibility; selected-author
controls read the authorized directory only when needed and preserve choices
across searches. The audience editor lives at `/wake`, with direct reload and
explicit Back/Cancel navigation. `/rooms/{roomId}` preserves native permission details,
generation-bound delegation and provenance-limited removal.

Session owns native lifecycle controls, pending decisions, runtime observations,
history contexts and terminal pointers. It distinguishes configured from observed
model, reasoning, sandbox/approval, native version, history mode, message size and
observation time; unknown fields are unavailable, not invented defaults.
Per-room observations retain immutable conversation attribution. Public-safe
projections contain no credentials, private endpoints, host paths or authentication
fields. Private terminal inspection uses the actual controller/SSH channel and
exact running context. Stopped/unavailable engines require explicit Resume;
inspection cannot create another engine, receiver or identity.

Decision detail remains at
`/manage/agents/{agentId}/decisions/{decisionId}`. Query hints never preselect
or submit. The authenticated page preserves all required choices/questions and
secret inputs; only explicit verified-owner confirmation submits, under CSRF
protection. GET never reads saved secret answers. Answered, cancelled, expired
and obsolete decisions cannot be answered again, and native receipt determines
actual resolution.

Agent Activity shows listener receipt/connectivity evidence and bounded original
failure causes, not another native configuration editor. Settings shows identity,
account access, fleet-instance retirement and installed/latest software. Software
opens on the active reported release, server's latest offered release and check
times. Offline observations are labelled last reported. Paginated historical
runs are inspectable but are not marked as awaiting upgrades. Release IDs compare
for exact equality, not guessed semantic order. Update guidance follows the
explicit pinned-package/controller workflow; no competing installer exists.

Only the selected task mounts and reads its resources. Navigation supports
direct URLs, reload, browser history and keyboard access. Superseded sections
and unknown URLs are unavailable, not redirects/aliases. Shared management
colors and paper-like hierarchy are independent of Element's site theme.
Identity/status context stays compact above navigation; permission ceilings,
pending/failed enforcement and destructive consequences remain immediately
visible. Mutations retain scoped authority, expected revisions, CSRF and
idempotency even when controls are hidden.

Same-key resource refresh retains mounted views without discarding edits. Editable
forms bind their field values and concurrency fences to one versioned snapshot.
Pristine forms adopt refreshed values/revisions; dirty forms retain their inputs
and original revision/generation, display an explicit conflict and block saving
until the human discards edits and loads the latest settings. Returning a draft
to its unchanged baseline also permits pristine refresh. Entity changes never
reuse another entity's draft. Grant access/delegation, chat wake policy, agent and
fleet naming, scheduled Wake-ups and instance policy use this shared treatment.
Instant account/lifecycle actions use the currently displayed entity revision;
they never borrow a retained naming draft's revision. Server concurrency checks
remain authoritative for changes racing an otherwise current submission.

Policy differentiates signup, capacity, enrollment/reconciliation and onboarding
sections with one atomic save. Enrollment review shows the exact owner,
controller, roster and each wake/invitation policy, including selected Matrix IDs.
It explains automatic policy application, no membership grant and private-DM
protection. Audit/activity hydrate recognizable current labels in one page-wide
authorized directory batch while retaining immutable stored attribution, exact
IDs and provenance in disclosures; there are no per-row network calls.
Each fleet roster remains a compact paginated linked-agent table, not repeated
agent detail cards.
The fleet's separate `/manage/fleets/{fleetId}/map` view is a dense, flat connection
graph: wake sources, packed agent nodes and shared room nodes. Its appearance uses
only the shared management theme, independently of any deployed Element theme.
The layout adapts to available content width, groups identical wake sources and
orders connections deterministically. Selection and search are durable URL state.
Keyboard/touch selection highlights connections and exposes agent/room detail
links; a textual legend and explicit labels supplement colors and line styles.
Agents without rooms remain visible. Desired access, muted delivery, pending or
failed enforcement and last observed membership are distinct; neither a grant nor
an online heartbeat proves a currently executing model turn. Allowed authors use
the same active-principal wake resolver as listener delivery; inactive configured
authors are not presented as eligible. Detail lists use shared pagination.
The read-only projection uses batched normalized queries and one label resolution
per distinct room, with at most four concurrent native reads. Unobservable room
names are explicitly unavailable rather than invented. Authorization is checked
before reads and again after asynchronous native labels. Snapshots are bounded to
1,000 agents, 10,000 room relationships and 2,000 rooms/principals; an oversized
snapshot fails explicitly, never returns a partial graph. The graph refreshes
every 30 seconds and on request, with capture time and refresh errors visible.
This view adds no domain tables, permission editor, telemetry or model calls.
Selected-author responses retain display labels for all selected principals,
independently of the current search/page. Empty optional UI filters are omitted
from URLs; an empty identifier is not a separate API meaning.

Room access offers native read/reply/custom levels up to the verified actor's
authority, with compact aligned controls and meaningful pending/applied errors.
Room selection and details live within agent management at
`/manage/agents/{agentId}/rooms/{roomId}`; fleet room plans link to those same
details. The navigation has no standalone Rooms section. The Connect page directs
humans to Element for room creation/configuration and to agent management for
access assignment.
Delegated invitations, provenance-limited removal and selected wake senders have
explicit controls; principal selection supports search and checkboxes. Bulk room
TOML has a full diff/confirmation and revision validation. Native session stop,
fresh-history reset, retirement and archive each state their different effects
and require the appropriate explicit confirmation. Retirement/archive cannot
bypass receipt-confirmed native stop or the server's current eligibility checks.
Every management confirmation uses one themed accessible modal, never browser
confirm/alert/prompt. Cancel initially owns focus; Escape/cancel restores the
trigger without a write. Background content is inert. A pending request cannot
be dismissed or duplicated; failures stay visible in the modal and retain the
same request identity/concurrency fences for a deliberate retry. Modals fit
desktop/mobile viewports with scrollable content. Complex pickers are durable
pages, not confirmation overlays. Element's native dialogs are unchanged.

The Connect page presents one universal setup flow: paste the minimal personalized
guide URL into an existing coding assistant, approve the exact roster once, then
verify the new managed agent and assign only necessary room access. It clearly
states that the coding conversation stays independent. One-agent and many-agent
setup share that same controller/CLI workflow; there is no separate advanced
deployment mode, optional launcher or current-session attachment instruction.
Requirements, prerequisite/provider installation and optional TOML/root details
are concise progressive disclosure behind the guide, not another installer.
Fleet approvals show exact names, failures, owner, controller, wake authors and
invitation defaults. Unchanged setup/resumption is not described as re-enrollment.
Resume validates the complete approved fleet, owner, immutable instance/account
bindings and active accounts with the saved scoped controller credential. It
performs no enrollment, coordination-policy, metadata or credential write. Owner
UI changes remain authoritative; TOML coordination defaults apply during initial,
new or renamed identity enrollment, or explicit `fleet enroll`. Invalid authority
fails visibly and never falls back to requesting enrollment.

All data lists use one first/previous/page/next/last pagination treatment. Server
queries are bounded and stably ordered with matching scoped counts. URL navigation
preserves filters. Bounded snapshots and in-progress editor selections use the
same controls without destroying unsaved form state. Table cells align vertically
at their center, including multiline identities, selectors, badges and actions.

Only administrators configure signup and invitation authority. Default signup
requires an invitation and only administrators may issue links. The issuer
policy may permit members too; members may invite only members and read/revoke
only links they created. Administrators can invite either human role and review
all links. Role-appropriate navigation and API authorization share this policy.

Invitees open a private link and continue to Element's normal username/password
registration. Crossfire has no second signup form. A short-lived HttpOnly cookie
is verified by the `org.crossfire.login.registration` Matrix user-interactive
browser stage: Element collects the username/password, opens the standard
authentication page, and the person confirms the exact account there. No token
copying, modified Element request code, or cookie-dependent Matrix JSON requests
are required. The stage binds immutable signup details and uses a same-origin
nonce-protected confirmation. The registration boundary consumes the invitation
and registers the normalized human principal. Open Element signup
is enabled only by policy and always assigns member authority. The public router
routes registration and dynamic Element configuration to that single owner.
Direct signup without a link cannot pass that stage in invitation mode. Open
signup uses the same stage without requiring an invitation; it grants only the
member role. Invitations retain their explicitly authorized role even when open
signup is enabled. A policy change, revocation or expiry is rechecked before
native account creation. UI-auth sessions are private, ten-minute, bounded
in-memory state; account passwords never enter application tables or logs.
Human usernames and configured names support 1–100 characters. The initial name
retains the complete username; invited/open signup, member changes and member/owner
representations share that bound without truncation.
Element configuration for the current hostname is rendered through the same
policy owner. Deployment-owned brand/theme assets remain presentation data and
cannot override signup authority.
Account creation and invitation claims are audited and preserve role boundaries.
Release notices follow the installed skill's lifecycle ownership. After human
consent, install the specified version-pinned public package, explicitly update
the fleet or selected instance from its bundled verified local assets, then
restart fleetd with that installed executable while preserving desired stop/resume
intent and exact histories. Remote updates may specify the already installed
absolute release directory; they never download an HTTP fallback.
Explicit replacement validates only the selected immutable package release and
its installed destination against the current artifact contract. The previous
managed entry is checked for ownership/path safety; its skill bytes are bounded
and hashed only to report whether instructions changed. Its manifest is not
interpreted as a current release or used as update authority. Recovery still
strictly verifies the activated current release and never substitutes software.
Update notices bind an exact opaque runtime session and release. Native identifier
formats remain adapter-owned; durable notice filenames use a hash of the session.

System-wide agent message instructions are configurable only by the administrator,
with reset-to-default. Attachment download uses native authenticated Matrix media.
Management style stays consistent; GAAP Element branding has its own repository.

## 14. Verification and delivery

The dated necessity ledger at
.analysis/20260929-164420-fleet-handover/necessity-ledger.md records every capability,
owner, minimality/performance rationale and exact evidence. The checked-in spec
is normative; execution notes never substitute for implementation verification.

Required banks:
- Large ordinary native file changes/output, complete actual approval review,
  structured native questions, exact choice/free-text response routing and
  unsupported request classification without killing healthy listeners.
- Shared history defaults and exact managed-session history resumption;
  independent fleet instance modes, per-room/DM resumption, mode changes without
  context copying/replay, scoped wake trails, same identity/process/listener and
  zero model work for routing or attachment.
- Owner-only complete non-thinking terminal mirroring, reasoning/secret-field
  exclusion, stream ordering, retry/deduplication, large output/artifacts,
  cross-owner disclosure policy, decision expiry/disconnection and no loops.
- Authenticated owner decision links, read-only GET/prefetch, CSRF-protected
  submissions, native request generations, duplicate/racing answers, obsolete
  requests, exact original-conversation responses and truthful native resolution.
- Latest-delivered-chat typing, exactly 30-second native expiry, no work-driven
  renewal, source changes, completion/interrupt/disconnect and controlled clocks.
- Lazy private management-DM creation/reuse with readable naming and only its
  member/service participants; no signup/startup/heartbeat conversation creation.
  Authenticated scoped failure reports, contained peer execution, independently
  detected lost contact, intentional-stop/idle/wait exclusions, one-episode
  notification deduplication and durable native delivery after outage recovery.
  Original sessions/publication uncertainty survive; no silent restart or replay.
- Public-safe configured/effective runtime observations and original failures;
  current/latest software summary, honest offline/history state and native
  desktop/mobile decision/configuration/activity views.
- Schema integrity, typed repositories, foreign keys, indexes/query plans,
  pagination/query counts, transaction rollback, no serialized domain state.
- Interval cadence, weekly/advanced cron schedules, IANA time zones, DST gaps and
  repeats, invalid/impossible schedule rejection, multi-agent independence,
  missed-occurrence coalescing, exact session-bound claims/receipt-only recovery,
  disabled/edited/deleted rules and current configuring-human authority.
- Real-browser Wake-ups CRUD, weekday/cron editors, assignment selection,
  owner/admin visibility, pagination, confirmations and desktop/mobile geometry.
  Actual Codex publication through the shared listener with
  inert providers, including owner-DM-only/empty-audience delivery, native busy and owner pause.
- Enrollment name races, exact one-roster approval, private credential recovery,
  complete role coordination review, stale-policy rollback, selected-sender
  authority, unchanged restart preservation, automatic current/future room
  permission materialization, cross-owner invitations and provenance-only removal,
  scoped fleet credentials, membership changes/controller updates and no leaks.
- Native Conduit grants/invitations/removal, cross-owner authority/provenance,
  revocation, selected/empty wake rules and durable blocked-mention cooldown.
- One receipt/cursor path, buffering/debounce/size limits, approvals and metadata
  reporting without model turns; no duplicated receivers after restart.
- Effective approval-policy capabilities, private unencrypted owner-DM validation,
  rejection of additional participants and forbidden native message powers,
  verified owner approval, expected native denial retaining the same session,
  intentional verified-client Matrix replies, and original failure diagnostics.
- Real stock Codex headless startup/options, private-home state, native
  input/receipt/output and same-session resumption, isolated inert provider,
  defaults, configurable model/reasoning/sandbox/approval and native bypass,
  conflicting option refusal, effective saved-session settings, synchronous Node
  subprocess I/O and native tool execution,
  normal owned-engine shutdown, no production or paid-provider calls.
- Daemon HTTP/Unix ownership, typed operation idempotency, local/SSH transport,
  CLI error/status contracts, disconnected CLI survival and explicit stop.
- Exclusive controller leases, loss/deadline deactivation, retained listener/runtime
  bindings, UI/CLI reactivation, queued-send cancellation, durable fleet-message
  receipts/fan-out and exact current-generation authorization for every agent.
  Rapid lease turnover, initial admission loss, canceled publication queues,
  empty sleeping checkpoints and coded transport cancellation retain exact native
  histories/unread cursors; explicit stops and expired retirement proofs stay fenced.
- Native TUI pointers to the exact session locally and through SSH, no extra
  model call/receiver/engine, TUI exit leaves the fleet running, stopped-run
  refusal, shell quoting and exclusion of authentication tokens from output.
- React browser flows for every management route, fleet/controller views,
  grants, principal selection, confirmations, auth boundaries and attachments.
- Real Element invited/open signup, issuer-policy scope, registration denial,
  independent managed-session setup, model-free listener tests,
  consent-notice receipts/restart deduplication, private-lock suspension/death,
  and transactional schema-13-to-14 migration preserving identities, histories,
  grants, receipts and audit while converting current and archived wake authority.
- Zero-question pinned npm setup, optional configuration, active verified owner
  descriptors, stable private defaults, approval/idempotency and explicit stop
  preservation. Strict unsupported-runtime and superseded-route/payload rejection.
  Clean-directory installation of only the public Fleet/fleetd tarballs proves
  private-module bundling, finite file allowlists, no registry internal dependency
  and no install-script activation. This is not registry-publication evidence.
- Exact live controller tuple on every new reporting run, immutable generation
  IDs, stale/closed/replaced-lease rejection, credential secrecy, retirement/archive
  eligibility and no directory/authentication authority from historical identities.
- Repository typecheck/build/test, architecture/import boundary and package-export
  checks, installation/release verification and final container/browser checks.
  No gate is weakened or skipped to call the product complete.

All authorized independently achievable work is completed before handoff.
The complete test command typechecks and builds each selected workspace once,
then executes independent test files in separate processes with a worker for
every available CPU core. Browser and native fleet integration belong to that
same run; architecture verification includes installation checks. Focused suite
commands select subsets rather than adding duplicate certification runs.
Runtime verification is Codex only. No alternate-runtime implementation, test
bank or opt-in flag is retained. Native inert-provider evidence identifies its
actual Linux/platform/protocol scope; it does not certify paid model behavior
or untested macOS execution.
Per-file output, durations and a machine-readable summary identify slow tails.
Test fixtures own distinct directories, databases, runtime homes, ports and
containers. Tests never mutate production or another fixture's state.
The service-owned test-support export provides one reverse-acquisition cleanup
stack for all three products; failures are reported after every owned disposer
has run. Listeners/clients stop before workers and their native backends.
Immutable client/web releases are built once and loaded by verification fixtures,
not rebuilt per test. Explicit changed-source build tests retain private inputs.
The selected browser suite extracts the pinned stock Element assets once before
parallel execution. Fixtures read those immutable assets while retaining separate
configuration, identities, databases and browser contexts.
Unconditional elapsed-time sleeps and browser timeout waits are forbidden by a
source gate. Listener cadence, collection windows, heartbeat and permission
expiry use the agent-core clock port; its native adapter owns real production
timers. Controlled test clocks never replace global Date, timers or I/O clocks.
Native protocol, process, browser and transport tests await bounded observable
completion; real transport deadlines remain actual I/O verification. Assertions,
supported runtimes and quality gates are retained when execution is optimized.

The feature branch contains one coherent implementation and explicit checkpoint
commits. Never push main or force-push. The user creates PRs manually from
/pull/new/<branch>. Production deployment is a separate action and production
data changes require a verified backup and forward migration.

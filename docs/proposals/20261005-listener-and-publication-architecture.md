# Listener, sleep and report-publication architecture review

Date: 2026-10-05. Status: approved design, reconciled with universal controller
ownership. The canonical specification is the sole current API/schema contract.
This review preserves dated baseline evidence and explains the required design;
it does not certify publication, paid models, macOS or production deployment.

## Current process and ownership model

Every agent belongs to a fleet, including a one-agent setup. fleetd is the
listening process; it embeds one shared listener host and owns the native runtime
lifecycle. The existing coding assistant executes setup instructions but keeps
its own process and conversation. There is no externally owned agent mode.

```text
fleetd process
  controller registry, persisted desired intent and durable operations
  shared listener host
    fleet groups and independently authorized agent bindings
    policies, acquisition, unread cursors, receipts, artifacts and telemetry
  one private listener-control endpoint
  native lifecycle adapters
    agent A -> exact saved history -> running, sleeping or explicitly stopped
    agent B -> exact saved history -> running, sleeping or explicitly stopped
```

When every native session sleeps, one fleetd application process remains.
Active native sessions add their owned process groups. This is not a count of
operating-system, container, helper or unrelated host processes.

One host does not mean one Matrix account or one global sync cursor. Each agent
retains its identity, credentials, room grants, wake policy and receipt ownership.
Crossfire uses one native acquisition path for each authorized binding, not a
controller-wide service-account inbox. Fleet delivery intent and the exact live
controller lease gate publication.

The only public products are `@ctlflow/fleet` and `@ctlflow/fleetd`. All other
modules remain private declared service packages. Setup consumes the verified
personalized descriptor and persisted defaults without questions other than
required human enrollment approval. Updating consumes installed version-pinned
assets, then explicitly restarts the daemon; recovery is not an installer.

## Dated baseline evidence

The original audit inspected Crossfire revision
`f59b1a9c4de74bc128d82807966b581779ee0bf4`, GAAP revision
`b7bc16e0103c373f9ce68958f548e4f72f18e3a5` and the Agreements repository at
`c532d4c1893767533f3fd9a0224edc5c360df542`. Site and agent repositories were
read-only inputs. These hashes describe that audit, not the current deployed
release or a new fetch by this documentation change.

The inspected baseline contained 700 tracked files, 429 product TypeScript files
and 25 application/package manifests. Its schema11 database had 54 tables.
The audit checked dependency/import forms, service ownership, normalization,
listener/runtime coupling, native histories, decisions, recovery and HTTP/content
security. It found undeclared type-import dependencies despite a passing
architecture case, duplicated control decoding and per-binding host resources,
GET-time controller configuration mutation and unsafe coupling between native
engine lifetime and receiver lifetime.

The baseline also did not establish whole-child supervision after native failure.
The current stock Codex 0.160 Linux audit confirms that a WS app-server can survive
fleetd's `SIGKILL`; a replacement using the same private home and UUID is refused
as an active second writer. Safe writer fencing is not automatic recovery or
whole-child containment. The selected remote-TUI transport has no supported
parent-lifetime primitive; the [native feasibility findings](../../services/crossfire/docs/architecture/feasibility.md)
record the actual boundary without introducing an emulated alternate path.
This is a demonstrated external native dependency limitation, not an unfinished
Crossfire supervisor implementation.

Earlier isolated browser evidence showed parent-domain cookie injection with
ordinary names and rejection with host-prefixed names. It also showed that
response-sandboxed scripts execute with an opaque origin and cannot access
cookie/localStorage/IndexedDB. Those were isolated fixtures, not a deployed
content-host proof or demonstrated production account takeover.

The original static review did not run a full build/runtime/browser cycle, paid
provider, fleet startup or production mutation. Current implementation evidence
belongs to the integrated verification records, not these historical counts.

## Canonical layer responsibilities

| Owner | Responsibility |
| --- | --- |
| Crossfire domain/contracts | Identity, enrollment, fleet membership/intent, exact controller authority, room permissions, revisions and bounded API validation. |
| Shared listener core | Stable binding, authorized acquisition, origin envelopes, wake filtering, private artifacts, serialized publication and receipt-confirmed cursors. |
| Native adapter | Exact Codex protocol/settings, owned process groups, saved contexts, native receipts, decisions, observations and aggregate activity. |
| fleetd domain/storage/composition | Durable desired Stop/Resume intent, native lifecycle, sleep/wake/recovery, local operations and composition of the shared host. |
| Private agent-tools package | One declared builder for the four immutable intentional-tool assets; no application-source reach-through or competing installer. |
| Fleet CLI | Canonical private daemon requests, setup, exact-history lifecycle, update and truthful read-only inspection. |
| Management UI | Authenticated task-oriented views using the same operations; it is not another scheduler, permission owner or native orchestrator. |
| Deployment repository | Host names, DNS/TLS, theme/image configuration and explicitly authorized rollout. |
| Agents repository | Role instructions and domain-specific document/report skills, not duplicate runtime or enrollment systems. |

A native connection generation is replaceable; Crossfire identity, history and
unsettled input are not. One publication journal/orchestrator accepts
adapter-supplied exact receipt proof. A socket write, process start or heartbeat
cannot acknowledge a Matrix message. Old-generation events cannot update a new
run. Superseded lifecycle/installer/control exports are removed, not hidden
behind a compatibility flag.

Managed role/skill/admin instructions use the native adapter's single
receipt-confirmed developer-item producer on create/resume/change. Codex must
support `thread/inject_items`; no spoofed user prompt, ignored native setting or
manual history writer can substitute. The current stock Codex 0.160 Linux source
proof verifies zero-model creation/resume/changed instructions with Sol/max
settings and an inert provider, plus exact receipts and bounded growing-history
recovery. It does not certify installed artifacts, macOS or paid-model behavior;
the integration owner still verifies the complete current release.

## Native sleep, wake and recovery

The instance-wide idle policy defaults to 1,800 seconds (30 minutes); zero
disables automatic sleep. The timer uses actual native activity across every
retained room history, not heartbeat, policy refresh or telemetry.

| Situation | Required behavior |
| --- | --- |
| Actual native work absent for the configured interval | Recheck activity/receipts and close only the owned native process group; retain binding/controller readiness. |
| Eligible DM, room assignment, scheduled wake or fleet message | Wake once, resume the exact saved context and use the existing serialized receipt path. |
| Input fails wake rules | Do not start an engine; preserve authorized context handling and model-free notices. |
| Any history is working, waiting for a decision, initializing or has uncertain input | Veto sleep. Unknown activity is not idle. |
| Input races with sleep | Retain input, serialize shutdown and resume once without losing or duplicating publication. |
| Delivery paused or current lease unavailable | No new model publication or receipt advancement; preserve saved state. |
| Human explicitly selects Stop | Stay stopped across native/controller restart; input cannot override intent. |
| Normal Resume | Exact retained history by default. Missing/unsupported native history is an actionable failure, not an implicit fresh start. |
| Confirmed fresh history | Reset only the intended managed context, retaining identity/configuration/access and the archived native history. |
| Native process failure | Preserve peers, cause, unread state and receipts; issue a durable owner incident and recover eligible transient failures independently. |
| Auth/release incompatibility | Report the exact owner action; no silent install, guessed protocol or fake success. |

Each agent has an independent supervisor, finite queues and fair work slots.
Aggregate host budgets limit acquisition, publication and native-start pressure.
Saved history inspection is read-only while sleeping; terminal connection to an
unavailable engine requires explicit Resume. A controller process itself must
be started through the documented local lifecycle, not an unrequested host
service. Native decisions retain exact original question/history binding.

## Required interaction and privacy behavior

Shared context is the default. Per-room native history is an optional instance
setting, not a forced one-room membership restriction. Histories isolate native
conversation state, not shared files/tools or arbitrary model output.

Every delivered envelope identifies sender, room/DM origin and time. Messages
above the instance-wide 64 KiB inline default use complete private file/directory
delivery. Authorized unread/history tools retain pagination and per-room fairness.
Intentional room/DM replies use tools; visible terminal output and native
questions go to the protected lazy owner DM, never a guessed room. Thinking
indication is scoped to the latest received room and expires automatically.

Room invitations/removals keep current human/native authority and attributed
inviter permissions. Fleet membership grants no rooms. Cross-owner invitations
do not change account ownership; owner mirroring is disclosure to that owner,
not confidentiality protection. Traffic/usage summaries remain bounded and
approximate. Missing provider cost data stays unavailable.

## Static publication and security

Agents intentionally publish a validated directory of HTML, JS/CSS and images
through the managed tool. Ordinary code builds the manifest, hashes and streams
declared files. There is no archive extraction, model-led hashing ritual,
server-side execution, SSR or report dependency installation.

The server issues a random 256-bit public key. The creator comes from authenticated
agent identity, not a body owner field. Canonical publication create/upload/commit,
list/detail and owner/admin deletion use the existing typed REST layer, normalized
`publication`/`publication_file` relations and bounded filesystem transitions.
The canonical specification, not this review, owns current numeric limits.

Anyone with the link can read a committed report. Unguessability is not
authentication. Deletion fences new public reads before bounded background
cleanup, but cannot erase saved files or screenshots. Publishing confidential
material requires explicit authorization; a document's embedded instructions do
not authorize disclosure. Public replies/reports omit credentials and internal
machine paths, hosts, endpoints and provider details.

The explicit HTTPS content origin serves only public content. It has no Crossfire
authentication or Matrix proxy. Executable HTML/SVG responses enforce CSP sandbox
with `allow-scripts` and without `allow-same-origin`, including directly opened
documents. Host-prefixed Secure, HttpOnly, Path=/ cookies have no Domain attribute;
management origin/CSRF enforcement rejects the content and opaque origins.
Credential-free asset CORS is not credentialed application API access. Safe MIME,
nosniff, no listing, no-store reads and exact manifest validation remain required.

Browser proof must cover script/module/asset behavior, inaccessible application
cookies/storage, rejected sibling cookie injection, rejected management requests,
deletion and error responses. This boundary prevents application credential
access; it does not make public reports trustworthy, prevent phishing or bound
all client CPU use.

## Verification and rollout boundary

Current source verification must include:

- Removed-form rejection, all import forms, dependency directions, private/public
  package separation and clean installed public artifacts.
- Controlled-clock sleep/wake races, changed/disabled policy, lease loss, manual
  Stop/Resume/reset and pending native decisions.
- All retained contexts, empty-history initialization, exact retry identity,
  uncertain/interrupted receipts and stale-generation events.
- Many bindings under finite aggregate budgets with independent failures and no
  model wake from status, history inspection or telemetry.
- Fresh schema13 and backed-up deployed-schema12 forward migration, normalized
  immutable historical archives, foreign keys, indexes and transaction rollback.
- Publication path/MIME/symlink/size validation, incomplete uploads, idempotent
  commit/delete, disk/transport failures, cleanup and public-read fencing.
- Real isolated HTTPS browser security, pinned Element signup/invitation behavior,
  task-oriented management desktop/mobile views and protected owner decisions.
- Codex-only current runtime gates inside verified finite process-group limits,
  file-level CPU parallelism, injected clocks and bounded native observations.

No superseded runtime implementation, test-selection flag or original-session
attachment workflow remains part of the design. Local fixture success does not
certify paid models, macOS, npm registry publication or deployment. Required
production changes need a verified backup and forward migration; production
reset is not a rollout mechanism. Website activation and fleet startup require
separate explicit authorization.

- [Canonical specification](../specification.md)
- [Development and bounded verification](../development.md)
- [Managed setup and pinned updates](../../services/crossfire/docs/onboarding/README.md)
- [Protected native decisions and diagnosis](../runtime-approval-readiness.md)
- [Publication contract and isolation](../../services/crossfire/docs/publications.md)

# Listener architecture audit and feature proposal

Date: 2026-10-05. Status: review complete; implementation proposal, not a release.

## 1. Scope and conclusion

This review covers the Crossfire monorepo, its three service owners, the relevant
GAAP deployment and Agreements fleet integration, and the requested publication,
idle-sleep and consolidated-listener capabilities. It does not authorize product
implementation, deployment, fleet activation, a commit or a push. Bad Bets belongs
to another session and is not changed.

**fleetd is the fleet's listening process. There is no need for a second process.**
It should embed the same reusable listener core used by standalone attachment,
manage independent agent bindings, and own native session lifecycles. When every
native session is sleeping, one fleetd application process remains. An awake
agent additionally has its owned native runtime process group. This is not a
promise about the number of operating-system, container or unrelated tool processes.

The current fleet already embeds listeners inside fleetd. The architectural defect
is their lifetime coupling to native sessions, not an extra listener subprocess.
The clean change is to separate binding lifetime from native-session lifetime,
consolidate host resources, and replace the current coupled implementation.

**The default idle timeout is 30 minutes (1,800 seconds), not 15 minutes.** It is
configured instance-wide in Crossfire, applies only to fleetd-owned sessions, and
zero disables automatic sleep. Wake-up resumes retained history; fresh history
remains an explicit, confirmed operation.

The implementation is not currently ready for these capabilities. Passing existing
architecture checks does not establish architectural compliance: this review found
a dependency-check gap that lets actual undeclared imports pass.

## 2. Inspection and evidence

Source baselines:

| Repository | Revision | Review state |
| --- | --- | --- |
| crossfire | `f59b1a9c4de74bc128d82807966b581779ee0bf4` | Clean feature branch `feat/reports-and-idle-sleep` before review documentation |
| gaap-lol | `b7bc16e0103c373f9ce68958f548e4f72f18e3a5` | Clean main; deployment integration inspected read-only |
| gaap-lol-agents | `c532d4c1893767533f3fd9a0224edc5c360df542` | Clean main; fleet/skill integration inspected read-only |

These repositories were fetched during the preceding feature preparation; this
report does not claim another remote refresh or deployment during the review.

- Baseline inventory: 700 tracked files; 612 source/script/test files in the
  inspected code inventory; 429 product TypeScript files and 25 app/package manifests.
- Repository-wide keyword, dependency/AST, ownership, schema and raw-SQL scans;
  detailed inspection of listener acquisition/publication, native histories,
  approvals, control endpoints, recovery, registration, persistence and HTTP security.
- All five product type-import expressions inspected; two reference undeclared
  dependencies. No additional undeclared imports or relative cross-owner imports
  were found by that product-source AST inventory.
- No product source module above 600 lines found. One browser test exceeds that
  size; this is not evidence that its product owner needs restructuring.
- SQLite currently has 54 tables at schema version 11. Table declarations use
  snake_case; domain state has explicit relations. Application queries use Tinqer;
  no raw application SQL was found outside the schema/metadata owner in this scan.
- Existing architecture test: one case passed. Structure verification passed,
  including timing checks over 159 source files and Codex-only default test selection.
- Documentation verification: ten local links and 26 source/line references checked;
  whitespace checks passed. The expanded import inventory reproduced both defects.
- The earlier credential audit in this task used real management/Element browser
  logins and an isolated hostile-content fixture. It did not test a deployed content
  service: none exists yet.

This is a repository-wide static audit with deep inspection of relevant owning
paths, not a claim that every line of every file was manually reviewed. No full
build/typecheck/runtime/browser cycle, paid model call, fleet start or production
mutation was performed for this architecture review.

## 3. Findings and required owner-layer changes

Severity indicates correctness or prerequisite risk, not a demonstrated exploit.

| Priority | Finding | Evidence | Required change |
| --- | --- | --- | --- |
| High | Receiver lifetime depends on a live native runtime | `services/crossfire/packages/agent-core/src/listen.ts:85`, `services/crossfire/packages/agent-core/src/listen.ts:98`, `services/fleetd/apps/daemon/src/execution.ts:127` | Stable binding/receiver lifetime; native connections attach and detach without stopping listening |
| High | Owned per-room activity inspection inherits only the primary history's inspection | `services/crossfire/packages/adapter-codex/src/owned.ts:28`, `services/crossfire/packages/adapter-codex/src/histories.ts:14`, `services/crossfire/packages/adapter-codex/src/connection.ts:309` | Aggregate every open/initializing history, decisions and pending publications; unknown activity must veto sleep |
| High | Native recovery restarts the whole listener and can fail after a server release changes | `services/fleetd/apps/daemon/src/execution.ts:114`, `services/crossfire/packages/agent-core/src/release.ts:5`, `services/fleetd/packages/domain/src/controller.ts:235` | Resume native sessions without reinstalling/restarting their receiver; obsolete listener-host restart must expose update-required state and owner action, never silent upgrade |
| Medium | Fleet domain imports transport-derived types from an undeclared package | `services/fleetd/packages/domain/src/model.ts:7`, `services/fleetd/packages/domain/src/model.ts:10` | Pure value definitions at the shared domain/core owner, declared exports/dependencies, explicit boundary mapping; not merely another allowed dependency |
| Medium | Architecture gate misses type-import expressions | `services/crossfire/tests/architecture.test.ts:41` | Inspect all import forms and enforce semantic dependency directions, with negative fixtures |
| Medium | Registration retains a legacy `r0` alias; public router recognizes arbitrary versions/trailing slashes | `services/crossfire/apps/server/src/http/create-server.ts:81`, `services/crossfire/apps/server/src/router.ts:35` | Verify pinned Element's actual registration flow, then one exact supported path set at both routing layers; removed forms must not bypass policy through the native proxy |
| Medium | Receipt orchestration is duplicated across native adapters | `services/crossfire/packages/adapter-codex/src/connection.ts:21`, `services/crossfire/packages/adapter-runtime/src/delivery.ts:23` | One publication/journal orchestrator, native-specific receipt proofs supplied through explicit capabilities |
| Medium | Every binding creates another loopback HTTP server; control-client decoding is duplicated | `services/crossfire/packages/adapter-crossfire/src/listener-endpoint.ts:13`, `services/crossfire/apps/client/src/listener-process.ts:23`, `services/crossfire/packages/adapter-crossfire/src/listener-client.ts:9` | One host control endpoint and one typed client, isolated binding capabilities; standalone is the one-binding case |
| Medium | Fleet inspection mutates configuration digest and revision during GET | `services/fleetd/packages/domain/src/controller.ts:58`, `services/fleetd/packages/domain/src/controller.ts:75` | Read-only inspection; explicit, revision-checked configuration application at the mutation owner |
| High prerequisite | Current ordinary cookie names do not prevent parent-domain cookie injection by a sibling host | `services/crossfire/apps/server/src/http/transport.ts:5`, `services/crossfire/apps/server/src/http/registration.ts:11` | One secure host-prefixed cookie per purpose plus the publication origin/sandbox boundary; no old-name fallback |
| Medium | Historical schema conversions remain executable for versions 1–10 | `services/crossfire/packages/adapter-sqlite/src/schema/create-schema.ts:17` | Inventory real stores; retain only required forward conversion inputs and reject obsolete prototype schemas explicitly |
| Medium prerequisite | Per-binding bounds are not a fleet-wide memory/concurrency budget | `services/crossfire/packages/agent-core/src/receive.ts:137`, `services/crossfire/packages/agent-core/src/chat-publication.ts:28` | Aggregate host budgets, fair acquisition/publication scheduling and bounded native-start concurrency |
| Medium | Parallel test output accumulates without a byte bound in coordinator memory | `scripts/test.mjs:51` | Stream evidence with bounded diagnostic tails; verify aggregate process-group resource budgets without weakening assertions or file-level parallelism |

The release finding is not a claim that every native restart currently fails.
Recovery reuses approved installed software, while listener startup requires exact
current-release equality. A changed release can therefore stop recovery with a
non-retryable conflict. Splitting lifetimes removes this check from ordinary native
wake/recovery. A genuinely unsupported host/credential still needs truthful owner
action; no architecture can promise recovery through revoked credentials or an
unavailable provider.

Current runtime intent (`wanted`) is in-memory in the controller. The new design
must persist desired activation separately from observed native phase so controller
restart can restore active bindings without reviving manually stopped agents.
This is not evidence that retained native history has been lost.

### Compatibility audit: remove, consolidate or retain

| Classification | Treatment |
| --- | --- |
| `r0` registration alias and arbitrary-version routing | Remove after actual pinned-client trace; do not guess upstream requirements or keep an undocumented exception |
| Two native receipt orchestrators | Consolidate orchestration, not native receipt evidence; there is already one durable journal format |
| Duplicate local control HTTP clients | Consolidate decoding/authentication and route all supported actions through the same client |
| Historical development schema inputs | Prune only after inventory; a required forward conversion is not a second current runtime schema |
| Native Matrix UIA `/fallback/web` | Retain: this is required interactive authentication, not a legacy compatibility fallback |
| Native first-turn/history-unmaterialized responses | Retain exact native semantics; unexpected/unsupported protocol calls fail, never resubmit through an old protocol |
| Per-runtime event/receipt differences | Retain as typed adapter capabilities; replace speculative field guessing with exact native discriminants where present |
| Offline history queries | Retain only through the same history-query implementation and exclusive receiver ownership; not another concurrent receiver |
| Shared versus per-room histories | Retain as explicit supported product modes, not old/new implementations; use one context-catalog owner |
| Codex, Claude and Pi individual attachment | Retain supported adapters; common core must remain common. Claude/Pi native test execution stays opt-in |
| Deprecated operations in generated native protocol metadata | Metadata alone is not a live compatibility handler; unsupported operations remain rejected |

No widespread parallel old/new Crossfire REST API or deprecated fleet CLI was found
by this scan. Existing negative tests reject legacy fleet and invitation paths.
This does not excuse the concrete registration alias or gate defect above.

## 4. Proposed process, ownership and interfaces

```text
fleetd process
  controller registry, desired intent and durable operations
  shared listener host
    fleet groups and independent agent bindings
    agent authentication, policies, cursors, receipts, artifacts, telemetry
  one private listener-control endpoint
  fleetd-owned native lifecycle
    agent A -> saved native history -> running or sleeping
    agent B -> saved native history -> running or sleeping

standalone listener process
  the same listener host, with one agent binding
  externally owned native connection; no start/sleep/reset authority
```

One listener host can serve the controller's registered fleets, with separate fleet
groups and agent capabilities. There is no second fleet-specific receiver engine.
Module separation does not imply process separation.

One host does **not** mean one privileged Matrix account or one global Matrix sync
cursor. Every agent keeps its own identity, token, room access, wake policy,
unread state and receipt ownership. Consolidation removes duplicate hosting and
lifecycle coupling; the underlying authorized agent streams remain independent.
Do not replace them with a controller-wide service-account inbox.

Interface ownership:

- Listener core owns a stable agent binding, authorized acquisition, origin
  envelopes, wake filtering, bounded artifacts and durable delivery accounting.
- A runtime binding selects the correct retained context and supplies publication,
  receipt, observation, decision and activity capabilities. Its live native
  connection generation is replaceable; its identity/history is not.
- fleetd supplies lifecycle ownership: start/resume, confirmed idle shutdown,
  failure recovery and explicit reset. Core code does not know how to spawn or kill
  Codex. An attached standalone binding has no lifecycle ownership.
- Native adapters own exact protocol parsing, settings, history resume, receipt
  proof, interruption and process-group cleanup. Unsupported capabilities are
  explicit, never emulated by an approximate fallback.
- Crossfire owns permissions, fleet delivery intent, instance policy and status
  projections. The UI requests operations; it never becomes another orchestrator.
- fleet CLI calls the same daemon operations. Terminal/status GETs never start a
  native session and never return a stale endpoint as a usable attachment.

Use one publication orchestrator with adapter-supplied exact receipt evidence.
Preserve Codex turn/client identifiers, interruption handling and uncertain-input
recovery. Never acknowledge Matrix/read cursors merely because a process started
or a socket write succeeded. Sleep/restart cannot retarget an uncertain publication
to another native history. Old connection events cannot update a new generation.

Existing APIs/exports must be replaced together with owned consumers and fixtures.
Do not retain the old coupled `listen` engine as a wrapper, hidden alternate mode
or compatibility export alongside the replacement.

## 5. Sleep, wake and recovery behavior

| Situation | Required behavior |
| --- | --- |
| No actual native work for 30 minutes | Close the owned native process group after a final idle/safety recheck; keep binding/controller ready |
| Eligible DM, room task, scheduled wake or directed fleet message | Wake once, resume the exact saved context and publish through the existing receipt path |
| Message that fails wake rules | Do not start a native session; retain current filtering/context behavior and model-free notices |
| Native turn active in any room history | Do not sleep, even if the primary/control history is idle |
| Pending decision, initialization, input or unsettled receipt | Veto sleep; waiting for an answer is not inactivity |
| Unknown native activity or cleanup state | Fail closed for sleep, report the uncertainty and reconcile; do not guess idle |
| Message races with sleep | Serialize the transition, retain the input, complete shutdown safely, then resume once; no lost or duplicated delivery |
| Fleet delivery paused or controller lease unavailable | Preserve existing no-new-delivery gate; reconnect without acknowledging unseen input or waking through the pause |
| User chooses Stop sessions | Remain stopped across controller restart; incoming messages must not override explicit stop |
| User resumes normally | Retained history by default; no implicit new session |
| User confirms fresh history | Explicit reset retains enrollment/configuration/access but creates the intended new native context |
| Native process crashes | Report an owner incident, preserve unread/receipt state and retry transient recovery independently for that agent |
| Listener host is obsolete or credentials are rejected | Report actionable update/authentication state; no silent install, fallback protocol or infinite fake-success loop |

The idle deadline uses real work/activity across all histories, not heartbeat,
policy refresh, statistics collection or unrelated non-waking messages. Controlled
clocks own timing tests. Instance policy stores seconds; management presents
minutes and a disable option. Policy changes recalculate deadlines without ending
active turns. Snapshot parameters and saved context IDs stay authoritative on resume.

Persist desired activation independently from transient running/sleeping phases.
After controller restart, restore eligible bindings and their cursors first;
sleeping/idle-active agents can remain without a native process until needed.
Controller startup itself remains an operator responsibility: no new systemd/global
service or promise of survival after the fleetd process itself is no longer running.

Each agent has an independent supervisor, finite in-memory queues and fair work
slots. Retry backoff is bounded in rate, cancellable and does not block unrelated
agents. Durable pending work does not expire into silent data loss. Host capacity
pressure must be visible and must not advance unread positions.

History discovery works while sleeping from saved metadata; live terminal
attachment requires an explicit resume if no native endpoint exists. Decisions stay
bound to their original native request/history. Planned idle sleep is not a crash
incident and must not spam owner DMs.

## 6. Required behavior that must remain unchanged

| Capability | Preservation requirement |
| --- | --- |
| Standalone attachment | Existing Linux/macOS user sessions remain externally owned; no auto-sleep, native restart or fleet configuration requirement |
| Native settings | Model, effort, sandbox, approvals and explicit bypass options retain canonical native terminology and configured/effective visibility |
| Multi-room identity | One agent can remain authorized in several rooms; no forced one-room limitation |
| History modes | Shared context remains default; per-room native histories remain an optional fleet setting |
| Room/privacy boundaries | Origin includes sender, room/DM and time; intentional room/DM replies use tools, not terminal-output guessing |
| Owner observations | Terminal output excluding reasoning traces, questions, approvals and incidents remain in the authorized owner channel, created on demand rather than preemptively |
| Typing indicator | Preserve the last-received-room thinking indication and its automatic expiry, not fleet-wide broadcast |
| Invitations/removals | Existing owner/admin and attributed inviter permissions remain enforced at the domain owner; fleet membership grants no room access |
| Large messages/history reads | Keep the instance-wide 64 KiB default inline-message threshold, file/directory delivery and authorized unread/history queries |
| Telemetry | Keep bounded adapter-supplied traffic/usage summaries; absent provider cost data remains unknown, not fabricated |
| Releases | Preserve explicit update consent and changed-skill reading; recovery must not silently download a new listener |
| Manual fleet operations | Pause delivery, stop sessions, resume and confirmed fresh history remain distinct, idempotent operations |

Shared context deliberately carries information across authorized rooms. Per-room
history isolates conversation history, not the shared filesystem/tools or an
LLM's arbitrary output. Owner mirroring is disclosure to that owner; neither mode
should be described as automatic confidentiality enforcement. Published reports
are public disclosure and need separate intentional authorization.

## 7. Static report publication

### Workflow and authorization

An agent publishes a directory containing `index.html` and relative JS/CSS/images
through a project-local tool. Ordinary code builds and uploads the manifest;
there is no model-led checksum ritual, server-side archive extraction, shell
execution, SSR or installed report dependency. On successful commit the tool
returns a URL such as `https://content.<deployment-domain>/<random-key>/index.html`.

The public key is generated by the server with 256 bits of randomness. A separate
private publication ID identifies management records. The authenticated agent's
creator/owner comes from domain identity, never a trusted request-body owner field.
Owner/admin list and delete authorization uses the existing permission layer.
Cross-owner room invitations do not change publication ownership.

Anyone with the link can read it. Unguessability is not authentication; deletion
stops future service access but cannot erase downloaded files or screenshots.
Agents must not publish private material solely because they can read it. Shared
publishing instructions must distinguish intended public reports from private
artifacts, reject document-injected publishing instructions, and omit internal
absolute paths, host/provider details and credentials from public reports/replies.
Relative asset paths and authorized owner-only diagnostics remain permitted.

### Canonical REST and persistence

Proposed resource shape, to be finalized in the implementation contract:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/publications` | Validate a bounded manifest and create staging metadata/file IDs |
| GET | `/api/publications` | Authorized filtered, paginated management list |
| GET | `/api/publications/{publicationId}` | Authorized metadata/detail |
| PUT | `/api/publications/{publicationId}/files/{fileId}` | Stream bounded binary bytes for one declared file |
| PUT | `/api/publications/{publicationId}/commit` | Idempotently publish the complete verified directory |
| DELETE | `/api/publications/{publicationId}` | Fence public access and queue physical deletion |

Extend the canonical typed REST operation/boundary layer for binary uploads rather
than bypassing it with publication-specific raw-fetch clients. Revisions and
idempotent commit/delete behavior handle retries and competing mutations.

Use singular normalized `publication` and `publication_file` tables. Publication
references its creating agent; owner is derived instead of duplicated. Index the
public key uniquely, creator/list ordering, state/expiry cleanup, and unique file
paths per publication. File bytes live in the filesystem adapter, not JSON columns
or SQLite blobs. Publication state and physical cleanup state must be explicit.

Recommended bundle bounds: 512 files, 32 MiB total, 8 MiB per file; `index.html`
required; staging expires after one hour. These are proposal values, not existing
deployed policy. Add explicit aggregate stored/staged byte budgets and upload
concurrency limits so many individually valid bundles cannot exhaust storage.
Paths/MIME types are boundary-validated; reject traversal, symlinks, duplicate
paths, undeclared uploads, partial files and size mismatches. Hash verification
belongs to ordinary code, not agent instructions.

Filesystem/network work stays outside database transactions. A finite publication
state machine coordinates atomic directory visibility with metadata commit and
crash reconciliation. Deletion fences serving first, then retries bounded cleanup;
a failed unlink must not keep the public URL readable. Staging cleanup must never
remove a committed publication. Start with no-store public responses so deletion
does not promise invalidation of a cache we do not control.

### Content isolation and current cookie evidence

The earlier live audit established host-only, Secure, HttpOnly, SameSite=Strict
management cookies; Matrix bearer authentication with no native authentication
cookie; and Element credentials in first-party browser storage. Management rejects
the proposed content origin and `Origin:null`. These are current observations,
not proof that arbitrary newly published scripts are already safely hosted.

Required boundary:

- Dedicated HTTPS content origin and content-only routing; no management,
  onboarding or native Matrix API proxy on that host. DNS/TLS/nginx belongs to GAAP.
- Response-enforced CSP sandbox with `allow-scripts` but **without
  `allow-same-origin`**, applied to executable HTML/SVG and direct document URLs,
  not merely an iframe preview. Safe MIME types, nosniff and no directory listing.
- Explicit public asset policy for local modules/images/data. Any necessary public
  CORS is distinct from application APIs and never enables credentials. Verify
  module/fetch behavior under the opaque origin in real Chromium.
- One canonical `__Host-crossfire` and `__Host-crossfire-invitation` cookie, Secure,
  HttpOnly, Path=/, no Domain, no old-name reader/writer. Tests must use browser-valid
  secure cookie contexts rather than invent an insecure alternate auth path.
- Same-origin/CSRF authorization remains enforced on management operations; do
  not rely on SameSite to protect a same-site sibling content host.
- Apply isolation to successful executable responses and error/redirect cases;
  verify deletion, cookie injection, storage access and API-origin rejection on the
  actual new host before enabling publication.

An isolated fixture demonstrated sibling parent-domain cookie injection with
ordinary names and rejection with host-prefixed names. The existing duplicate-name
parser fails closed; this is **not** a demonstrated live account-takeover exploit.
The fixture also proved sandboxed scripts run with an opaque origin and cannot use
cookie/localStorage/IndexedDB access. A deployed hostile-bundle test is still needed.

The sandbox does not make malicious content trustworthy, prevent phishing or bound
all browser CPU use. In particular, do not promise that a top-level document can
never navigate its own window. This boundary isolates application credentials and
storage; it is not a guarantee that every possible public-script behavior is safe.

Primary browser references:
- [Host-prefixed cookie requirements and scope](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [Response CSP sandbox, opaque origins and navigation limits](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox)
- [Native Matrix client authentication](https://spec.matrix.org/v1.12/client-server-api/#client-authentication)

## 8. UI and configuration

- Instance Policy: clear fleet idle-sleep section, default 30 minutes, disable and
  validated custom duration. Do not overload room wake rules or account permissions.
- Fleet/agent tables: listener readiness/delivery and native phase are separate.
  Sleeping is not offline, and connected is not proof of native progress. Include
  last work, saved-history availability and actionable errors without dumping IDs.
- Session actions: existing resume/stop/reset hierarchy; fresh history retains
  confirmation. Sleeping history inspection is read-only; no automatic wake on GET.
- Reports: a paginated management table with title, creating agent, date, public
  link, publication state and confirmed owner/admin deletion. Reuse filters and
  detail components from agent/fleet views rather than duplicate page owners.
- Management theme and paper-style hierarchy remain authoritative, with tabs and
  tables rather than nested cards. Keep desktop/mobile accessibility and meaningful
  empty/error states. Do not edit Element for these capabilities.

## 9. Proposed file ownership

Illustrative responsibility splits, not parallel implementations or a requirement
to create a file/package for every line below:

```text
services/
  crossfire/
    packages/agent-core/src/
      listener/              host, binding, acquisition, publication, activity
      runtime/               pure binding/activity/receipt capability ports
    packages/adapter-runtime/src/
      delivery.ts            single durable publication orchestrator
      journal.ts             single journal owner
    packages/adapter-crossfire/src/
      listener-endpoint.ts   host endpoint, isolated binding routing
      listener-client.ts     one typed control client
    packages/adapter-codex/src/
      histories.ts           retained contexts and aggregate activity
      owned.ts               native ownership composition
    packages/domain/src/
      publication/           values, ports, authorization, transitions, queries
      runtime/               pure shared runtime values
    packages/contracts/src/  current REST/runtime/policy wire validation
    packages/adapter-sqlite/src/
      schema/                current schema and required forward conversion
      publication/           Tinqer repositories
    packages/adapter-filesystem/src/publication/
                             bounded staging, file storage, cleanup
    apps/server/src/
      http/routes/           authorized publication operations
      content/               content-only server, headers and streaming
    apps/web/src/            policy, status and Reports views/components
    apps/client/src/         publishing commands and shared listener client use
    tests/                   architecture, migration, publishing, native/browser proofs
  fleetd/
    packages/domain/src/     desired intent, lifecycle operations and pure state
    packages/storage/src/    durable intent/context references and operation state
    apps/daemon/src/         composition of bindings, native sessions and idle policy
    tests/                   lifecycle, races, recovery, idle and fairness proofs
  fleet/
    packages/daemon-client/  canonical typed current daemon operations
    apps/cli/                status, resume/reset and truthful terminal pointers
    tests/                   CLI/API symmetry and removed-form rejection
docs/                        specification and product-guide entry points
```

Use existing service-local owners and declared exports. No global package pool,
application-source reach-through or unnecessary new package/framework is proposed.
GAAP owns only site host/TLS/container wiring; Agreements owns shared publishing
skills/instructions, not another runtime or permission implementation.

## 10. Implementation and acceptance plan

| Phase | Work | Acceptance |
| --- | --- | --- |
| 1. Lock contracts and enforcement | Promote approved design to specification; strengthen dependency gate; pure shared values; exact registration routes; migration/store inventory | Negative fixtures catch type-import/direction violations and removed API forms; pinned Element signup evidence; no production reset |
| 2. Replace listener ownership | One reusable host and typed control client; independent bindings; one receipt orchestrator; explicit native generations and aggregate activity | Standalone and fleet use the same receiver; no superseded engine/export; isolated authentication and exact receipt/cursor behavior |
| 3. Implement managed sleep | Durable desired intent; 1,800-second policy; idle vetoes; wake/recovery and manual-operation races; truthful saved-context inspection | Controlled-clock and inert native proofs; same history IDs after stop/wake/controller restart; unknown/working/decision states never killed |
| 4. Add safe publication | Normalized domain/repositories; typed binary REST; bounded filesystem transitions; host-prefixed cookies and content sandbox | Cross-owner auth, commit/delete/crash races, finite bounds, schema integrity and real hostile-browser isolation |
| 5. Integrate presentation and agents | Management policy/status/Reports; CLI symmetry; shared fleet publishing instructions; comprehensive guides | Accessible desktop/mobile workflows, no data dump/card proliferation, public disclosure clearly explained, no model housekeeping |
| 6. Verify and roll out | Full cross-layer gates; reviewed backup/forward migration; explicit content DNS/TLS; site/controller/source synchronization | Codex default gates and post-deployment real browser flows; Agreements remains stopped unless separately authorized; manual PR preparation per affected repo |

Verification must include:

- Fake-clock sleep/wake boundary races, zero disabling sleep, changed policy,
  controller lease loss, manual stop/reset/resume concurrency and pending questions.
- Shared and per-room native histories, active room with idle control history,
  empty-history/context initialization, controller/native failure and generation-stale events.
- Uncertain native receipts, interrupted turns and exact retry identity; no cursor
  advancement, duplicate turns or hidden fresh history on resume failure.
- Many bindings with fair scheduling, bounded aggregate buffers/start concurrency,
  independent failures and no native wake from telemetry/status/history inspection.
- Fresh target schema and backed-up deployed-schema forward conversion; foreign
  keys, transaction rollback and query indexes. Reject obsolete forms explicitly.
- Publication path/symlink/MIME validation, disconnect/disk-full/incomplete uploads,
  duplicate commit/delete, expired staging and public-read fencing before cleanup.
- Actual content-origin hostile bundles: script execution works, main/Element
  credentials/storage remain inaccessible, host-prefixed cookies reject sibling
  injection, management rejects forbidden origins and content exposes no API.
- Native Element invite-link signup/login, existing attachment/control/approval
  flows, saved terminal pointers and management desktop/mobile views.
- Full monorepo build/typecheck/test/architecture/install gates for the eventual
  cross-layer implementation. Codex native tests are default; Claude/Pi are run
  only with the user's explicit flag. Keep file-level parallelism and no sleep-based
  timing tests. Stream test logs to bounded evidence instead of unbounded RAM capture.

No new paid-model certification, macOS native certification or deployment success
is claimed by this report. Before implementation, refresh merged mains without
discarding shared work. Before rollout, verify a fresh backup and explicit hosts,
ports, DNS/TLS and stopped-fleet expectations. Native histories/identities and real
production data must be preserved.

## 11. Decisions and remaining prerequisites

Recorded requirements: one fleetd listening process; common standalone/fleet core;
no compatibility/dual paths without explicit scoped user authorization; 30-minute
configurable fleet-only idle sleep; exact-history resume; public isolated report
hosting and owner/admin deletion. These require no second fleet daemon or Matrix
service identity.

Recommended implementation choices: one host control endpoint, normalized two-table
publication model, streamed declared-file uploads, explicit publish commit,
host-prefixed cookies, response sandbox and finite bundle/storage limits. These
remain proposal details, not silently added completed requirements.

Evidence prerequisites, not requests to invent compatibility: pinned Element's
registration trace, inventory of actual migration inputs, native activity/receipt
proofs, and actual content DNS/TLS/browser verification. If a native requirement
genuinely conflicts with the no-compatibility rule, report that exact conflict and
ask for a scoped decision; do not add an implicit workaround.

Documentation/policy updates are the only changes made for this review. Product
implementation and deployment remain pending the proposal discussion.

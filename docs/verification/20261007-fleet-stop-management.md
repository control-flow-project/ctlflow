# Fleet stop and management navigation

## Incident

The Agreements controller completed the requested fleet stop on 7 October 2026
at 00:05:53 IST. All 28 instances were stopped and their saved histories retained.
Crossfire still showed the operation as running and disabled Resume.

The operation receipt handler also attempted to manufacture native-stop
retirement proofs for every latest listener run. Some runs belonged to older
controller generations. Their correct generation checks rejected the operation's
transaction. Reconnects created new generations without resolving that mismatch.
The UI separately presented historical native activity as a prominent badge.

## Owning fixes

- Crossfire accepts final lifecycle outcomes from the currently authenticated,
  claimed controller generation without synthesizing native-stop proofs.
- Retirement keeps its exact native-close, current-run, current-lease and receipt
  requirements. Successful stop operations do not weaken that authority.
- The controller worker acknowledges an already-final reclaimed operation without
  reexecuting native work. Operation identity and saved histories remain intact.
- Batched latest-run summaries distinguish confirmed Stopped from unverified
  offline observations. History availability remains a separate measurement.
- Fleet controls and operation history live at `/manage/fleets/{fleetId}/sessions`.
  Controls observe current operations even while browsing older history pages.
- Management confirmations share a themed, accessible modal with pending/error
  handling. The wake audience picker is a URL-addressable page with Back/Cancel.
- Approved fleet resume validates existing identities and active accounts using
  the current scoped controller credential, without enrollment or policy writes.
  Initial/new/renamed identities and explicit enrollment retain owner review.

During restoration, normal start incorrectly compared TOML enrollment defaults
against Nell's owner-edited wake policy and requested a new whole-fleet approval.
The unwanted request was rejected through the normal owner API without changing
authority. Separating resume from explicit enrollment at fleetd's preparation
interface fixes this defect without approving replacement defaults.

## Recovery and verification

The rollout must preserve production state and native history, verify consistent
backups before activation, settle the existing controller operation through the
normal receipt path, and restore the exact pre-stop enabled instances. Previously
stopped instances remain stopped. No fresh history, database reset, new identity
or unsolicited task is part of this recovery.

Regression coverage includes mixed historical generations, receipt replay,
lease rollover/reclaim, strict retirement rejection, per-agent stop scope,
later reporting generations, current-operation controls on historical pages,
themed confirmation focus/cancel/pending/failure handling, and wake-page drafts,
direct URLs, mobile layout and revision conflicts.

## Initial 0.1.9 verification

- Typecheck and all service builds passed.
- All 702 tests passed across 159 isolated files on 24 parallel workers; no
  failures or cancellations. Test execution took 89.744 seconds after 2.316
  seconds of shared preparation, including 15 resume-authority boundary cases.
- All 33 architecture checks and four public installation checks passed.
- Container checks passed for startup, native Matrix/Element routes, authenticated
  attachment downloads, management, artifacts, shutdown and persisted rooms.
- The final immutable listener release is `0.1.9-2fa06475ac6a316a2511f041`.
  Matching public CLI/controller packages are `0.1.9`; internal packages stay
  private. Already published `0.1.8` archives are not replaced.

These are integrated source and native-fixture results, not a claim that every
real model task or production failure mode has been certified. The production
rollout separately verifies backups, release identity, operation settlement,
preserved accounts/rooms/native histories and real management browser flows.

## Initial 0.1.9 production results

- The website runs image `gaap-runtime:3c071fd92bd76ffa1515`, with runtime source
  `00852e08b9c5cc3c1d8eb80c61c26679d5add018` and the exact listener release above.
  Both public `0.1.9` archives match their registry integrity and the installed
  Turbine packages. No internal package was published.
- Verified quiescent website/controller/provider backups precede activation.
  Consistent SQLite before/after inspection preserves all 37 protected relations.
  All 28 Matrix identities, native history scopes and private provider-file
  fingerprints are unchanged. No database, room or history was reset.
- The original stop completes through the normal authenticated receipt path.
  No operation remains pending/running. Exactly 15 previously enabled receivers
  are restored; 13 deliberately stopped instances remain stopped. Read-only
  native thread queries confirm the 15 resumed saved histories and workspaces.
  Nell retains both owner-selected wake senders; all 19 visible rooms remain.
- Postdeployment Chrome checks pass for 44 management route/viewport combinations
  and both wake-picker viewports. Additional desktop/mobile checks confirm enabled
  Resume, settled stop history, themed confirmation focus/Tab/Escape/Cancel,
  viewport fit and zero mutation on cancellation. No native browser popup or
  page error occurs. Actual screenshots were inspected. No model task was sent.

That rollout exposed a provider authentication dependency: the retained fleet
Codex login failed native provider workspace authentication with HTTP 401, while
Turbine's current login belonged to a different provider account. The owner
subsequently authorized that account change and activation-time refresh, described
below. History restoration or an available model catalog alone does not establish
provider authentication.

## Authorized resume-login correction

The owner subsequently authorizes every resume to use the current host Codex
login, including the new provider account. Authentication is no longer retained
as immutable history state: one Codex-adapter activation path atomically copies
the current private host login before native startup/resume/wake/recovery.
Preflight checks that host login without changing an already-running engine.
Invalid or unsafe input fails before startup; absent source files cannot retain
a stale credential fallback. Native history, configuration, Matrix identity,
room/wake authority and unread positions are unchanged. A running engine needs
stop/resume to pick up a later host-account change; status reads never hot-switch
its login. Native fixtures use isolated credentials, never production logins.

Focused regression tests pass for repeated login refresh, private/atomic files,
unsafe/malformed/missing sources, preflight isolation, exact retained history,
explicit sleep resume and message-driven wake after binding restoration. The
coordinated controller/CLI release is `0.1.10`; only those two packages are public.
Typecheck/build, 709 tests across 160 isolated files on 24 parallel workers, all
33 architecture checks, four installation checks, container checks and audit
with zero known vulnerabilities pass. The full run takes 81.746 seconds including
5.117 seconds of preparation.

Both public archives were downloaded, integrity-checked and installed through
normal npm before website activation. The verified quiescent backup preceded
image `gaap-runtime:dee467eac8c2f8ef2ccb` from `e4eac68`. Native read-only checks
confirmed actual provider authentication, retained histories and configured
model/effort for the 15 resumed engines. A subsequent startup/update restoration
race exposed stale state-lock errors. Normal controller restart restored those
15 receivers without enabling the 13 deliberate stops; the permanent owner-layer
correction is included in `0.1.11`.

## Saved selection and interrupted work

Fleet Stop stores its enabled-agent selection separately from current intent.
Fleet Resume restores that selection and leaves deliberately stopped agents off.
Individual Stop removes its target; repeated Stop and intentionally empty
selections remain durable across controller restarts. Confirmed fresh-history
reset retains its explicit full-fleet or individual scope.

Working or decision-waiting contexts retain a bounded private checkpoint with
exact native context/session IDs and a stable continuation receipt. Resume
validates every saved history and sends its restart instruction only after
listener policy, reporting and local tools are ready. Input cannot overtake
initialization. Idle histories receive no synthetic task; questions and
permissions remain unanswered. A room-scoped instruction stays in that exact
history, and a shared instruction invents no destination room. Receipt recovery
does not certify exactly-once external task effects.

The Codex adapter terminates its dedicated owned process group, not just its
launcher, and waits for shutdown before replacement. Queued controller restoration
loses ownership before an explicit update can start replacements. A completed
operation releases its active-operation fence before reporting success.

Focused 70-test verification passes, including actual stock Codex against an
inert provider, interrupted native shutdown, exact retained history, readiness,
decision safety, storage boundaries, selection and CLI behavior. Full-suite
parallel execution exposed a fixture publishing JSON before its write completed;
the fixture now publishes its complete evidence atomically without weakening
assertions. Final integrated verification passes typecheck/build, all 722 tests
across 161 isolated files on 24 parallel workers (80.532 seconds, 2.714 seconds
shared preparation), all 33 architecture checks and four installation checks.
Container checks pass for startup, Element room creation and authenticated
attachment downloads, React/native routes, artifacts, shutdown and persisted
rooms. Audit reports zero known vulnerabilities.

## Final 0.1.11 production results

- Both public packages are `0.1.11`. Canonical registry downloads match the
  locally verified archives; normal exact npm installation on Turbine and
  installed lockfile-integrity checks pass before website activation. Only
  `@ctlflow/fleet` and `@ctlflow/fleetd` are published.
- The website runs `gaap-runtime:55c1d627888a63537197` from runtime source
  `83229bddd31592933b1f83f475a2890550d1285b`, advertising
  `0.1.11-2fa06475ac6a316a2511f041`. Exact release/web bytes, image provenance,
  health, rootless execution, read-only root, dropped capabilities,
  no-new-privileges and loopback-only main/content ports pass inspection.
- Verified quiescent website and controller/fleet/provider backups precede
  replacement. The daemon retains the exact desired-intent bytes. The canonical
  update succeeds for all 28 installations, restoring only the 15 enabled
  receivers and leaving 13 deliberately stopped agents off.
- Read-only native checks before and after the UI lifecycle exercise verify
  actual login, configured model/effort, project skills and exact saved histories
  for all 15 running engines. All 28 identities/history scopes and provider-file
  fingerprints remain retained. Each resumed agent's private login is recopied
  during the actual UI Resume and matches the current host login.
- Postdeployment Chrome verification passes 44 management route/viewport
  combinations and both wake-picker viewports. Actual desktop/mobile
  confirmation checks pass viewport fit, Cancel focus/restoration and zero
  requests on cancellation, with no native popup or page error. Screenshots
  are inspected.
- An actual UI Stop succeeds in 3.619 seconds. The controller and table confirm
  all 28 receivers stopped; stale Working/Idle/Sleeping badges are absent.
  A controller restart while stopped starts no agent and retains the exact
  15-agent resume selection. UI Resume succeeds in 27.321 seconds, restores
  exactly those 15 with the original history IDs, and leaves all controls usable.
  No fresh history, permission decision, room change or test assignment is sent.
- Consistent SQLite inspection passes schema 14, integrity and foreign keys.
  The direct immutable-before comparison correctly flags the two authorized
  UI operations' fleet revision and request timestamp changes. Both successful
  owner-authored receipts prove the exact consecutive revisions 25 → 26 → 27.
  All other fleet fields remain identical. All 37 protected relations (1,330
  original records) pass the unchanged strict verifier against those explicitly
  authorized post-lifecycle expectations; no field is ignored. The original
  backup and production data are not modified by verification. All 28 accounts,
  33 room grants, 29 wake entries, three members, nine owner conversations and
  two publications are retained.

Private evidence is under `.temp/fleet-stop-release/`, including native, browser,
release, isolation, backup and exact preservation reports. The interrupted-turn
proof uses stock Codex with an inert provider; production inspection is read-only
and sends no model task. These results do not certify every paid model task,
external side effect, abrupt controller kill or operating system.

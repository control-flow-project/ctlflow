# Rewrite feasibility checkpoint

The checks here distinguish **observed native behavior** from the rewrite's
required guarantees. A passing characterization test does not itself accept a
limitation; the maintainer's explicit revisions below determine the current
requirements. The live coordination service is unchanged.

## Reproduce

Requirements: Node 26, npm 11.17.0+, the locked dependencies, Docker, Codex CLI 0.156.1 and
tmux on Linux. The actual TUI fixture is isolated and makes no model calls; it
does not start an implementation worker. Every fixture uses private local
endpoints and independent databases/session state under ignored `.temp/`.

```sh
npm ci
docker pull matrixconduit/matrix-conduit@sha256:f13263ad11be1f41cc4d89d8ee0f4ccbcc846efacf51abab2d859e073faef642
npm run verify:architecture
```

`scripts/verify-architecture.ts` compiles the proof's strict functional TypeScript
with `.js` ESM imports into a fresh `.temp/architecture-build-*/` directory using
`tsconfig.architecture.json`, then runs only that build's tests. Old output cannot
silently supply deleted tests or stale modules. The native HTTP fixture
bounds requests to 15 seconds and responses to 1 MiB. Docker startup/commands
have finite deadlines. The native RocksDB fixture uses a private bind-mounted
database under `.temp/`, not Docker's writable image layer. Readiness is one
bounded native HTTP version probe; no fixed sleep or process-state heuristic
substitutes for a successful response. Only fixture-owned containers/TUI/server processes are
stopped. Scratch evidence is not automatically deleted or committed. Never
substitute a production endpoint or database into these fixtures.

The proof includes representative Node HTTP service/client validation, actual
published Tinqer execution, native Matrix requests and an actual attached/closed
Codex TUI. It does not claim the production service or its security controls are
already implemented.

### Native installation policy

Host installation and the runtime image consume the same checked-in `.npmrc`.
Native `engine-strict` requires Node 26+ and npm 11.17.0+, including with lifecycle
scripts disabled. npm 11.17.0 is the first version supporting the required
package-name age exemptions. The maintainer approved immediate use of the two
consumed Tinqer packages; only those names are exempt from the seven-day guard.
Third-party dependencies, including their transitive dependencies, remain guarded.

`npm run verify:installation` compiles and runs only the focused installation
proof through the same fresh-output runner. It checks host configuration, Docker
context/COPY and lock admission alignment, actual npm 11.16.0 rejection before
installation touches `node_modules`, and the real image fingerprint after changing
only policy bytes. An isolated native registry proves aged selection, fresh range
and exact-version rejection, the two approved exemptions, rejection of another
package in the same scope and continued protection of their transitive dependency.
The negative installer is downloaded as aged, pinned fixture tooling into private
scratch; it is never installed globally or added to Crossfire's dependencies.

The age policy governs native dependency selection; a locked replay is not a
second independently implemented dependency resolver. No guard, peer or force
override is used. These proofs certify the configured native install policy,
not security against an operator deliberately overriding their own npm settings.

- [npm 11.17.0 native exemption support](https://github.com/npm/cli/releases/tag/v11.17.0)

Early repeat runs exposed intermittent startup failures while initializing a
fresh database in this machine's HDD-backed Docker image layer. Inspection found
Conduit blocked in disk I/O before its native TCP socket existed. Moving the
fixture's own database to its project-local scratch directory removes that
unintended storage coupling without changing the pinned server, RocksDB options,
permission assertions or startup deadline. This is fixture isolation, not a
production performance/durability certification.

## TypeScript and published Tinqer

Pinned integration dependencies:

| Dependency | Version |
| --- | --- |
| TypeScript | 6.0.3 |
| `@tinqerjs/tinqer` | 0.0.28 |
| `@tinqerjs/better-sqlite3-adapter` | 0.0.28 |
| `better-sqlite3` | 13.0.3 |

The seven-day minimum release age remains active in `.npmrc`, except for the two
explicitly approved owned packages. The integration uses Mycroft's verified
published release, not a workspace dependency or unpublished tree.
The Snapped and Lesser projects supplied real usage examples; no second ORM is
introduced.

`scripts/architecture-proof/data.test.ts` proves these native database behaviors:

- A hostile string is bound as data, is absent from emitted SQL text, and cannot
  expand an owner-qualified query to other owners or drop the table.
- A native immediate transaction commits an agent record and its audit together.
- A foreign-key failure rolls back both records; it is not translated into a
  success result or compensated with a second mutation.
- A revision-qualified native update increments the row's revision; a stale
  update affects zero rows and cannot overwrite the current record.
- A second SQLite connection cannot acquire a concurrent immediate writer or
  see an uncommitted record. Committed records survive reopening the file.

Arithmetic updates use Tinqer's documented row-expression form, rather than
assuming every arbitrary expression inside an object-valued `set` is supported.
Native transaction ownership remains with SQLite, not an asynchronous JavaScript
transaction wrapper. These checks prove dependency feasibility, not the complete
quota/enrollment state machine or cross-service atomicity.

`runtime.test.ts` executes one functional HTTP/client/Tinqer round-trip: the
validated value is inserted and selected through the published adapter in a
native transaction before returning the stored value. Invalid/unknown fields,
length violations and oversized requests create no database rows. The database
fixtures/queries have one owner shared with the focused data proofs. The final shared
contracts are still owned by `src/contracts/`; the test fixture is not a parallel
production validator or management API.

The small native RPC observer rejects malformed JSON/results and oversized
frames, closes its own connection and settles pending calls. These are bounded
fixture-transport checks, separate from the real TUI lifecycle experiment.

## Pinned Conduit: supported controls and gaps

Runtime image: Conduit v0.10.14, immutable digest
`sha256:f13263ad11be1f41cc4d89d8ee0f4ccbcc846efacf51abab2d859e073faef642`.
Source inspection: tag v0.10.14, commit
`ff5a243b8e93fa2d0b82dd13fa714618d50091fa`.

The isolated fixture permits native room creation to exercise admission and
power-level controls. That does not enable room creation on the running service
or prove the complete proposed deny-all account policy. Its first account creates
a private room and invites two other independent accounts. Alice is *designated*
as Holmes's owner for the experiment; stock Conduit has no authoritative owner
relationship to configure. The proof does not pretend an existing ownership
extension has been bypassed.

| Native operation / condition | Observed result | Meaning |
| --- | --- | --- |
| Fresh native agent `joined_rooms` | Empty | Native registration need not imply default joins |
| Ordinary message below `events_default` | 403 / `M_FORBIDDEN` | Positive native power-level control works |
| Typing by that read-only joined identity | 200 | Message power levels do not enforce this ephemeral restriction |
| Designated owner's read of a post-kick event | 403 / `M_FORBIDDEN` | Positive control: the owner cannot access that later content |
| History after designated owner is kicked | 200; includes a later message | Independent native memberships are not owner-dependent delegation |
| Native agent display-name update/read | 200; changed name returned | No administrator-controlled agent naming ceiling |
| Presence online update | 200 | Request acceptance alone proves no stored presence |
| Shared-room presence read after update | 404 / `M_NOT_FOUND` | Working presence is absent even with common membership |

The proof preserves native power-level fields, including the selected room
version's creator semantics; it does not manufacture a creator entry or downgrade
room versions to obtain a passing permission test.

Source corroboration:

- `src/api/client_server/typing.rs`: native typing checks joined membership,
  then updates typing; no message-power-level check supplies read-only typing.
- `src/api/client_server/profile.rs`: the authenticated identity writes its own
  display name; there is no human-owned agent/admin naming restriction.
- `src/service/rooms/edus/presence/mod.rs`: updates/pings return success without
  storage; reads return no event; presence-since returns an empty map.
- `src/api/ruma_wrapper/axum.rs`: token resolution authenticates the native
  user/device or appservice. It does not establish account kind, ownership or
  continuing delegation. Adding those facts only in a client cannot protect
  another direct native caller.

These observations refuted the original strict specification. They remain
native characterization evidence, not failures against requirements that the
maintainer subsequently changed. Sync/search/media/notification,
account/device/login/registration and in-flight revocation paths still require
full implementation acceptance tests. Accepting the specific limitations below
does not waive unrelated security requirements.

Primary sources:

- [Pinned Conduit presence implementation](https://gitlab.com/famedly/conduit/-/blob/v0.10.14/src/service/rooms/edus/presence/mod.rs)
- [Pinned Conduit native typing](https://gitlab.com/famedly/conduit/-/blob/v0.10.14/src/api/client_server/typing.rs)
- [Pinned Conduit native profile updates](https://gitlab.com/famedly/conduit/-/blob/v0.10.14/src/api/client_server/profile.rs)
- [Native Matrix permissions](https://spec.matrix.org/v1.12/client-server-api/#permissions)

## Milestone 2: direct admission, history and media proof

The next native proof uses the same pinned server, with room creation disabled
for ordinary accounts, and a private room with `joined` history visibility.
It does not exercise the live instance. The shared bounded transport also carries
media bytes, so comparing actual downloaded content does not rely on status alone.

Observed controls:

- Registration without the private authority cannot complete a dummy challenge.
- A zero-room ordinary identity cannot create a room or join the private room.
- A private message is readable by a joined agent, denied to the unjoined identity,
  and a post-kick message is denied to the removed agent while the creator reads it.
- Authenticated native media returns the exact attachment bytes to a joined agent.
- The unauthenticated legacy media route denies this newly uploaded content with
  `404 M_NOT_FOUND`; the modern media route without a token returns 401.

**Additional restrictions are not proved and are not silently waived:**

- A zero-room authenticated identity can download that same known private-room
  `mxc://` attachment through the native authenticated media API. The pinned
  handler's media store receives a boolean authentication flag, not a room/owner
  delegation check. Room power levels do not narrow this access.
- Applied kick denies new messages but leaves previously authorized server-side
  history and known attachment bytes accessible through new native requests.
- A zero-room history query returns the private room's `m.room.create` event,
  including creator and room version. The strict no-content assertion remains
  failing; it is not weakened into a product acceptance claim. Pinned source
  `user_can_see_event` returns true when an event has no short-state hash.

The initial run wrongly expected the messages route to return whole-request403
and suspected anonymous download access. Direct responses and source inspection
disproved those hypotheses. The corrected run retains the strict no-room-content
assertion; it reports **14/16 passing, two failures from that same assertion**
across the new access proof and unchanged HTTP/homeserver transport callers.
The other two observations are successful characterizations, not acceptance of
roomless media or post-revocation server access.

Management UI/client filtering cannot enforce additional restrictions against
direct native calls. The maintainer must decide whether the access contract adopts
these native Matrix semantics or requires additional homeserver enforcement.
Neither broader native integration nor a proxy is assumed approved. These are
not implied waivers from the four earlier accepted limitations.

- [Native Matrix authenticated media API](https://spec.matrix.org/v1.12/client-server-api/#get_matrixclientv1mediadownloadservername-mediaid)
- [Pinned native media handler](https://gitlab.com/famedly/conduit/-/blob/v0.10.14/src/api/client_server/media.rs)
- [Pinned event visibility implementation](https://gitlab.com/famedly/conduit/-/blob/v0.10.14/src/service/rooms/state_accessor/mod.rs)

## Actual coding-session lifecycle

The Linux proof starts a fixture app-server and opens a real interactive Codex
0.156.1 TUI against its private socket in a separate tmux server. It captures the
exact native thread created by that TUI, not a guessed latest session. No prompt
or model turn is submitted. The observer only initializes and reads native
metadata; it does not create/resume/fork the thread or take controller authority.

| Condition | Native thread state | Direct-input capability |
| --- | --- | --- |
| Real TUI attached and idle | `idle` | `true` |
| That TUI process exits; app-server survives | `idle` | `true` |

The proof verifies that the actual TUI terminates and that the app-server process
survives. Consequently, native thread reachability, `idle` and
`canAcceptDirectInput` alone do not establish the required TUI-attached presence.
The created origin/source metadata is not current attachment authority either.

The official app-server documentation describes `thread/closed` after the last
subscriber's inactivity grace period, not an immediate exact-controller departure
notification. A listener's own subscription and continued thread activity also
must not become proof that the human's TUI is attached.

- [Official Codex app-server lifecycle documentation](https://developers.openai.com/codex/app-server)

The existing local-session adapter is therefore not certified for A27 by this
checkpoint. The maintainer requires the listener to exit when its intended TUI
exits. Establishing and verifying that exact association is implementation work;
native reachability alone is not a lifecycle signal. The shared daemon must not
be stopped merely because one TUI exits. No orphaned listener is reported online
to satisfy a UI expectation.

## Approved requirement revisions

On 2026-09-28 the maintainer accepted these exact native limitations after
clarification. `rewrite.md` and its acceptance map own the updated specification,
not the superseded strict guarantees:

1. **Eventual owner ceiling:** Crossfire management applies native restrictions;
   a server reconciliation worker reduces stale agent permissions periodically,
   defaulting to 300 seconds. Owner/native permission changes outside Crossfire
   can leave agent access intact until reconciliation succeeds. Store desired
   versus applied state and report failures; do not claim per-request enforcement
   or an unconditional five-minute guarantee during outages.
2. **Native read-only:** messages/reactions and administration are denied through
   native permissions; joined agents may still use typing. This accepted limit
   replaces the original no-ephemeral-actions promise.
3. **Configured names:** Crossfire persists the configured owner-qualified name
   and administrator override. Native Matrix display names remain agent-mutable;
   show them separately from verified ownership and configured identity.
4. **Unavailable presence:** display unknown with the pinned Conduit, including
   zero-room agents. No fake availability, custom heartbeat or homeserver
   presence implementation is added.

The evidence/clarification is recorded by the Matrix events:

- Initial revision: `$I8Zd439J6hImTD2WbCHyYt3iKH1wtGAvUAL05FLlAYs`.
- Exact limitations explained: `$fdasbpocCoSkE_SR6ZWA6BXndVaJ-4hSz7FVXBIucbU`.
- Acceptance: `$6lfAlDJ9Isrp0mepWlm9NBKrpD7wqidge1G9ON2_Tu4`.

These changes remove the need to modify/replace Conduit for those four items.
Keep direct native Matrix and one Crossfire delegation/reconciliation owner.
Account-kind, registration, zero-access defaults, remaining native access paths
and exact Linux TUI/listener shutdown are still implementation/proof obligations,
not assumed successes. If further proof demonstrates a new architectural
conflict, explain it rather than silently introduce a proxy or weaken the rule.
Linux-only certification is approved; there is no Windows/macOS support claim.

The next milestone waits for Mycroft's review of this exact corrected checkpoint.
No server replacement, Matrix proxy, fake presence or local TUI wrapper has been
introduced. The current evidence does not implement a management reconciler.

## Checkpoint verification

Verified on Linux with Node 26.8.1 and Codex CLI 0.156.1:

- Locked dependency installation with the seven-day age policy intact.
- Root `npm run typecheck` and `npm run build`.
- Baseline `npm test`: 131 passed; no test was weakened or skipped.
- Baseline `npm run verify:codex`: three real-Codex integration tests passed.
- `npm run verify:architecture`: 18 checks, including native capability gaps,
  HTTP/Tinqer integration, database behavior and malformed protocol boundaries.

- Independent fresh fixture runs confirm repeatability after the database
  isolation correction; the original finite deadlines remain unchanged.
- `git diff --check`, ignored scratch/analysis and no tracked `.analysis` paths.

### Corrected checkpoint

The correction upgrades both published Tinqer packages to `0.0.28` and reruns
the full proof bank: **22 checks pass**, including the four native installation
checks. Its fresh install, strict type check and standalone client build pass.
The strengthened installation proof separately passes after adding its
transitive-dependency control. The owning version/launcher bank passes all four
checks. Unchanged baseline behavioral certification above is retained, not
substituted for the new Tinqer/install evidence.

A fresh isolated runtime image build succeeds. An offline read-only probe of that
actual image confirms Node 26.10.0, npm 11.19.1, the seven-day setting, both exact
owned exemptions, strict engine admission and Tinqer 0.0.28. The image also rejects
actual npm 11.16.0 with `EBADENGINE` without touching a fixture sentinel. A cached
build had failed with a missing Docker parent snapshot; the successful fresh
no-cache build does not certify that damaged cache. No cache pruning, production
restart or database reset was performed.

An additional isolated lifecycle run using Codex `0.158.0` reproduces the same
direct-input false positive after the real TUI exits. This is not an exhaustive
proof against every possible native attachment capability.

After the approved specification revision, the focused native homeserver bank
passes all seven checks with its original assertions unchanged. Only the proof
labels now describe characterized limits rather than rejected requirements.
Strict compilation and the 35-row acceptance-map check pass. The earlier SQL,
protocol and Codex evidence is retained for its unchanged inputs.

This certifies the stated architecture/proof checkpoint only. Production
management, enrollment, native restriction reconciliation, onboarding migration,
listener lifecycle, React/browser flows and complete Docker certification remain
pending. The updated guarantees need product acceptance evidence, not merely
green characterization tests or this install-policy image probe.

# Rewrite feasibility checkpoint

The checks here distinguish **observed native behavior** from the rewrite's
required guarantees. A passing characterization test that exposes a gap is not
acceptance of that gap. The live coordination service is unchanged.

## Reproduce

Requirements: Node 26, the locked dependencies, Docker, Codex CLI 0.156.1 and
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
| `@tinqerjs/tinqer` | 0.0.27 |
| `@tinqerjs/better-sqlite3-adapter` | 0.0.27 |
| `better-sqlite3` | 13.0.3 |

The seven-day minimum release age is preserved in `.npmrc`. The integration
uses the published adapter, not Mycroft's unpublished dependency-refresh tree.
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

This is not an exhaustive bypass certification. Sync/search/media/notification,
account/device/login/registration and in-flight revocation paths still require
the approved enforcing integration and full acceptance tests. The demonstrated
gaps already refute stock pinned-server sufficiency for the agreed specification.

Primary sources:

- [Pinned Conduit presence implementation](https://gitlab.com/famedly/conduit/-/blob/v0.10.14/src/service/rooms/edus/presence/mod.rs)
- [Pinned Conduit native typing](https://gitlab.com/famedly/conduit/-/blob/v0.10.14/src/api/client_server/typing.rs)
- [Pinned Conduit native profile updates](https://gitlab.com/famedly/conduit/-/blob/v0.10.14/src/api/client_server/profile.rs)
- [Native Matrix permissions](https://spec.matrix.org/v1.12/client-server-api/#permissions)

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
checkpoint. A concrete exact-controller lifecycle capability or explicitly
approved local attachment contract must be selected and verified before it can
announce TUI-attached availability. No orphaned listener is reported online merely
to satisfy a UI expectation.

## Required architecture decisions

The unchanged specification cannot be met by stock Conduit configuration plus
the current reachability-only local adapter. This conflict must be resolved
before dependent management implementation. These are not discretionary quality
tradeoffs or permission to weaken the requirements.

1. **Homeserver enforcing integration:** authorize investigation of a suitable
   homeserver/native extension that supplies the required ownership/delegation,
   account-kind/naming controls and presence, while preserving direct Matrix.
   Selection requires proof across native read/write/ephemeral/account paths and
   one authoritative policy owner. A replacement alone is not presumed to add
   ownership semantics. A native extension may require changes outside this
   Crossfire TypeScript repository; that scope is not implicitly authorized.
2. **Exact local attachment:** authorize and select a concrete lifecycle contract
   for the already-open TUI. An upstream native controller-lifecycle capability
   or a verified explicit local attachment can be evaluated; guessed process
   scans, loaded-thread status and listener self-heartbeats are not solutions.
3. **Client platform certification:** state which operating systems must be
   certified. This checkpoint verifies Linux only and makes no Windows/macOS
   claim. TypeScript removes the earlier NativeAOT artifact requirement, not
   platform-specific lifecycle verification.

No Matrix proxy, asynchronous membership copier, fake presence service, client-only
permission gate, server replacement or local TUI wrapper has been introduced.
The next implementation milestone waits for Mycroft's exact-commit review and
the required maintainer decisions. Remaining obligations stay in the acceptance
map; none are silently removed.

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

This certifies the stated architecture/proof checkpoint only. Production
management, enrollment, authorization integration, onboarding migration,
presence/lifecycle changes, React/browser flows and complete Docker certification
remain pending. The current homeserver/runtime gaps are not waived by a green
characterization suite.

# Native boundaries

The supported client is Linux with stock Codex 0.158.0 or newer. Certification
uses the actual executable, an isolated Codex home and an inert local provider,
not a simulated engine or a production credential.

## Codex WebSocket attachment

The launcher supplies a private authenticated loopback connection descriptor;
the native tool environment supplies the exact selected thread ID. Crossfire
reads that session's workspace/load state, then joins its event stream
with native `thread/resume` and `excludeTurns: true`. No configuration override
is sent. The native API may load that exact saved thread if it stops being loaded
during attachment; Crossfire neither selects another thread nor creates an engine.

On 0.158.0, a newly created thread without its first human input has no persisted
rollout and cannot be joined by that API. The client reports the native error;
it does not send synthetic input, start a second thread or switch transports.
Pasting the project onboarding into the intended session is normal human input.

Native input acceptance is not delivery confirmation. The adapter checks the exact
user-message receipt and its content. Native history pagination is bounded.
The adapter journals publication intent before submitting input and retains
confirmed content hashes until the listener checkpoints its Matrix position.
A lost response is not grounds to resubmit. An unresolved publication remains
an explicit error unless exact native evidence resolves it; receipt recovery
does not start a model turn.

A TUI can leave while the server keeps a thread loaded. Crossfire makes no TUI
lifetime claim. Receiver shutdown closes only the receiver connection.
The app-server's own shutdown disconnects delivery. Tests prove other sessions
and the external engine remain alive when Crossfire disconnects.

Native approval messages require exact supported action scope and native choices.
Verified Matrix owner replies can answer those requests; a model never supplies
approval authority. The stock TUI remains free to handle its native prompts.

## Controller-owned headless Codex

fleetd composes the shared listener with the functional owned-runtime adapter.
The adapter starts stock Codex with a private authenticated loopback WebSocket,
validates native model/reasoning/permission settings, and creates or resumes the
work area's exact saved thread. Native history materialization persists an empty
thread without synthetic user input. Credentials, instructions and native state
remain in the instance's private work area.

Real stock 0.158.0 tests with an inert provider prove zero-turn startup and resume,
model/reasoning configuration, actual Matrix delivery and receipt recovery after
restart. Orderly stop ends the owned listener and Codex process. The product does
not promise whole-descendant cleanup after engine shutdown or process crashes.
It introduces no native fork, global service or alternate listener implementation.

## Conduit

The pinned Conduit image is `v0.10.14`, digest
`f13263ad11be1f41cc4d89d8ee0f4ccbcc846efacf51abab2d859e073faef642`.

Accepted semantics:

- All authenticated accounts, including agents, can create public and private
  rooms through Element or native Matrix. No homeserver-admin promotion is needed.
  Enrollment joins no rooms; private-room admission remains enforced. Native
  public joining and creation are not blocked by Crossfire's periodic grant sweep.
- Power levels deny ordinary messages, reactions and administrative changes;
  native typing can still succeed for a read-only member.
- Human and agent accounts are independent. Crossfire applies explicit changes
  and reconciles downward drift periodically, default 300 seconds.
- Room kicks block new private messages but may preserve earlier authorized
  server history. Known room IDs can expose creation metadata.
- An authenticated account knowing a media URL can download its file without
  room membership. This is not a per-room file ACL.
- Native display names remain mutable; Crossfire ownership and configured names
  are separate durable facts.
- Presence updates do not yield reliable native presence reads. Management shows
  explicitly labelled Crossfire listener heartbeats, not native Matrix presence.
- Account deactivation invalidates tokens and password login. Revocation is
  distinct from room removal.

These behaviors are deliberate product boundaries, not unimplemented promises.

## Verification owners

- `tests/native-attachment.test.ts`: external-engine ownership, exact thread,
  credentials and disconnect.
- `tests/native-settings.test.ts`: native model/reasoning/workspace preservation.
- `tests/native-owned-runtime.test.ts`: owned headless engine, zero-turn persistence,
  native settings and exact resumption.
- `tests/delivery-journal.test.ts`: lost-response publication evidence and restart.
- `tests/fleet.integration.ts`: compiled fleet CLI, daemon, Conduit and stock Codex
  through enrollment, invitations, delivery, same-session restart and shutdown.
- `scripts/native-tests/`: actual model-protocol receipts, busy delivery,
  interruption, commands and verified-human approval.
- `tests/native-core.test.ts`, `tests/onboarding.test.ts`: actual identity,
  native grant/revocation and durable enrollment.
- `tests/native-delivery.test.ts`: native room-state notices and private receipts.
- `tests/browser.test.ts`, `tests/fleet-browser.test.ts`: actual React, SQLite,
  native Conduit, Codex and fleet management together.
- `scripts/architecture-proof/`: pinned dependency/native characterization.
- `tests/operator.test.ts`: startup inputs and build identity.

A passing characterization test documents a native behavior; it does not imply
a stronger guarantee. Disposable fixtures never adopt or reset live state.

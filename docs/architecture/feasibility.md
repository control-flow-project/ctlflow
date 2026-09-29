# Native boundaries

The supported client is Linux with stock Codex 0.158.0 or newer. Certification
uses the actual executable, an isolated Codex home and an inert local provider,
not a simulated engine or a production credential.

## Codex WebSocket attachment

The user supplies an authenticated loopback endpoint and exact selected session.
Crossfire reads that session's workspace/load state, then joins its event stream
with native `thread/resume` and `excludeTurns: true`. No configuration override
is sent. The native API may load that exact saved thread if it stops being loaded
during attachment; Crossfire neither selects another thread nor creates an engine.

On 0.158.0, a newly created thread without its first human input has no persisted
rollout and cannot be joined by that API. The client reports the native error;
it does not send synthetic input, start a second thread or switch transports.
Pasting the project onboarding into the intended session is normal human input.

Native input acceptance is not delivery confirmation. The adapter checks the exact
user-message receipt and its content. Native history pagination is bounded.
A lost response is not grounds to resubmit; interruption recovery must first
prove the original input absent.

A TUI can leave while the server keeps a thread loaded. Crossfire makes no TUI
lifetime claim. Receiver shutdown closes only the receiver connection.
The app-server's own shutdown disconnects delivery. Tests prove other sessions
and the external engine remain alive when Crossfire disconnects.

Native approval messages require exact supported action scope and native choices.
Verified Matrix owner replies can answer those requests; a model never supplies
approval authority. The stock TUI remains free to handle its native prompts.

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
- `scripts/native-tests/`: actual model-protocol receipts, busy delivery,
  interruption, commands and verified-human approval.
- `tests/native-core.test.ts`, `tests/onboarding.test.ts`: actual identity,
  native grant/revocation and durable enrollment.
- `tests/native-delivery.test.ts`: native room-state notices and private receipts.
- `tests/browser.test.ts`: actual React, SQLite, native Conduit and Codex together.
- `scripts/architecture-proof/`: pinned dependency/native characterization.
- `tests/operator.test.ts`: startup inputs and build identity.

A passing characterization test documents a native behavior; it does not imply
a stronger guarantee. Disposable fixtures never adopt or reset live state.

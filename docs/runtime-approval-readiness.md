# Managed runtime approval readiness

## Current ownership

Every Crossfire agent belongs to a fleet. fleetd owns the shared listener host,
private instance state and native Codex process groups. The coding conversation
performing setup remains independent; no readiness check adopts its process or
history. Codex is the only implemented runtime. Typed adapter ports own native
settings, decisions, receipts, observations and exact saved-context lifecycle.

Every reporting run requires its exact live controller lease. Saved credentials,
a controller heartbeat or process existence alone do not prove replying. Agent
**Session** shows native parameters, decisions, contexts and terminal inspection;
**Activity** shows listener/receipt evidence; **Settings** shows current/latest
software. Native failures and lost contact are distinct observations.

## Historical failure and ownership

The agreements fleet's Ada and Bea received their owner's messages and attempted
intentional replies. Their applied Matrix room permissions were correct. The
reply client failed during Git privacy verification, then the model requested
native escalation. No approval room was configured. An expected missing-route
failure closed the native connection, and the controller hid the original cause
behind a generic disconnect. Idle online status had not proved replying. This
records an earlier incident, not the current managed fleet's execution status.

The subprocess failure is not Git-specific. Stock Codex's Linux restricted-network
seccomp policy denies `shutdown`. Node's synchronous captured subprocess I/O uses
that syscall to half-close an existing local socket pair. Commands can exit zero
and produce correct output while `spawnSync` still reports `EPERM`. Independent
`true`, `printf`, shell and Python probes reproduce the class of failure. An
asynchronous Git-only substitution would mask the defect without fixing native
subprocess capabilities.

## Crossfire contract

- The Codex adapter interprets explicit native permission policy and supplies
  typed approval capabilities. Live policy comes from the actual managed thread,
  not a guessed Crossfire default or the independent setup conversation.
- The first owner contact or real native approval request establishes the
  protected private read/write owner DM. Real visible terminal output uses the
  same lazy conversation. Starting, reconnecting and testing
  creates no chats; a roomless authenticated listener is ready. No global
  approval-room configuration exists. Established channels are checked for
  current applied grants, unmuted delivery, active identities, both joined
  members and native message powers.
- `fleet test FLEET` and the managed intentional `agent test` use actual existing
  shared-host diagnostics. They start no controller, native engine or chat, do
  not advance unread positions and make no model call. An unauthorized established
  approval conversation never reports ready.
- The permission broker returns expected failures through `Result`. The Codex
  adapter selects an exact offered native denial or cancellation; approval
  expiry, unavailable transport or lost authorization does not terminate an
  otherwise healthy session. Invalid native requests remain fatal.
- Only the verified owner can answer the original pending native request through
  its authenticated Crossfire review form. Choice links and GET requests never
  approve; explicit submission requires CSRF protection and all required answers.
  Ordinary DM replies are chat, not approvals. The listener returns the response
  to the exact native request as control input, never a new model prompt.
- Command/file approvals and structured native questions share this one decision
  owner. A received native response is not proof the subsequent task succeeded.
  Expiry and cancellation erase private answers; lists, URLs, audit and activity
  never contain submitted answer values.
- Native runtime failure immediately makes that execution inactive. The controller keeps
  the bounded actual cause, preserves successful peers and excludes restart
  during failure cleanup. Secondary cleanup failure does not erase the cause.
- The shared host/binding remains independent of native engine lifetime. Eligible
  transient recovery resumes the exact saved history without inventing fresh
  context. Explicit Stop persists across controller restart. Idle sleep keeps
  the binding ready; pending decisions, work, receipts and unknown activity veto
  sleep. Protected management incidents use the existing lazy owner channel.
- Git privacy checks retain the actual subprocess error and distinguish it from
  a genuine Git exit. Failed subprocesses never bypass private-storage protection.

## Reusable verification

Inspect existing state with the installed CLI:

```sh
fleet daemon status --root /absolute/controller
fleet show FLEET
fleet test FLEET
```

The managed session uses its private instance state, not optional workspace cwd:

```sh
node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" agent test
```

Terminal inspection uses the controller's exact current context and ordinary
SSH/tunnel access; inspection starts no engine. A stopped/unavailable session
needs explicit Resume. Never request ports, tokens or Matrix passwords from a
model. Readiness does not certify paid-model work or every native tool capability.

Run the normal gates inside a verified finite process-group resource scope:

```sh
systemd-run --user --scope --quiet \
  --property=MemoryMax=25769803776 --property=MemorySwapMax=0 \
  --property=TasksMax=4096 /bin/bash -c \
  'npm run typecheck && npm test && npm run verify:architecture'
```

`npm test` includes the shared build. Focused cases use `MemoryMax=4294967296`,
`MemorySwapMax=0` and `TasksMax=512`.
Runtime heap limits alone do not contain native/browser children. The integration
owner verifies the complete current source; this guide does not claim a new run.

The focused cases live in:

- `services/crossfire/tests/runtime-decisions.test.ts`: immutable request binding,
  exact owner, private answers, expiry, receipts, incident recovery and private
  management-DM permission enforcement.
- `services/crossfire/tests/runtime-observation.test.ts`: complete visible output,
  no reasoning, coalesced streams, immutable retry bodies and typing expiry.
- `services/crossfire/tests/runtime-history.test.ts`: actual native structured
  questions and persistent exact-context history/terminal attachment proofs.
- `services/crossfire/scripts/listener-permissions.test.ts`: roomless listeners
  report readiness without creating chats; failed first-use routing denies only
  the pending request; unauthorized established routes do not report ready;
  owner decisions work while paused.
- `services/crossfire/scripts/native-tests/permissions.test.ts`: stock Codex with
  an inert local provider, actual native approval, forbidden/unavailable denial,
  following input in the same session, and an intentional Matrix reply through
  the verified intentional tool in a controller-owned, Git-protected native workspace.
- `services/crossfire/tests/client-state.test.ts`: real Git privacy and real
  missing/inaccessible executable diagnostics without credential creation.
- `services/crossfire/tests/release-awareness.test.ts`: complete verified installed
  assets and strict actual diagnostic contract without a second installer/receiver.
- `services/fleetd/tests/execution-validation.test.ts`: generic adapter approval
  capabilities without provider-key interpretation.
- `services/fleetd/tests/controller.test.ts`: actual failure causes, immediate
  inactivity, peer independence and cleanup/restart ordering.

Native fixtures explicitly unsubscribe their test-owned setup connection after the listener
subscribes. They do not leave a second client rejecting approvals, autoapprove a
request or assume a denial creates another provider response. Denial is proved
by native idle inspection, absent command effects and subsequent publication to
the same session. Approval and message output are separate observations.

## Recorded native dependency evidence

The Linux subprocess fix belongs in Codex's `linux-sandbox/src/landlock.rs`.
Removing the unconditional `SYS_shutdown` denial allows half-closing an existing
IPC descriptor. It does not create a connection. Network socket, connect,
send and io_uring restrictions remain enforced. Adjacent native tests cover Unix
half-close, denied network socket creation and real captured Node subprocess I/O
with input, output and exit-status preservation.

The recorded isolated local patch against Codex revision `44fe510ce3` passed the complete
Linux sandbox bank: 224 tests passed and three existing platform cases skipped.
Restoring the stock shutdown rule fails the captured subprocess control with
`EPERM`. This is a local native-owner proof, not an upstream release or permission
to install a custom Codex binary. Crossfire includes no runtime patcher, alternate
Git spawn path, sandbox relaxation, system service or restart workaround.

Managed Codex defaults to `danger-full-access` with `on-request` approvals.
All runtime settings remain configurable. Explicit
`dangerously_bypass_approvals_and_sandbox = true` selects full access and `never`;
conflicting settings fail. This approved policy avoids restricted-sandbox IPC
without a custom runtime. The failure evidence remains applicable to restricted
policies. Inert-provider tests do not certify paid-model work.

- [Development and resource-bounded verification](development.md)
- [Current decision and native lifecycle contract](specification.md)
- [Fleet configuration and native parameters](../services/fleet/docs/configuration.md)
- [Management Session and Settings](../services/crossfire/docs/management.md)

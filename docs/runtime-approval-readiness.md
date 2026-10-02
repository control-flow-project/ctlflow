# Runtime approval readiness

## Failure and ownership

The agreements fleet's Ada and Bea received their owner's messages and attempted
intentional replies. Their applied Matrix room permissions were correct. The
reply client failed during Git privacy verification, then the model requested
native escalation. No approval room was configured. An expected missing-route
failure closed the native connection, and the controller hid the original cause
behind a generic disconnect. Idle online status had not proved replying.

The subprocess failure is not Git-specific. Stock Codex's Linux restricted-network
seccomp policy denies `shutdown`. Node's synchronous captured subprocess I/O uses
that syscall to half-close an existing local socket pair. Commands can exit zero
and produce correct output while `spawnSync` still reports `EPERM`. Independent
`true`, `printf`, shell and Python probes reproduce the class of failure. An
asynchronous Git-only substitution would mask the defect without fixing native
subprocess capabilities.

## Crossfire contract

- Runtime adapters declare whether approval belongs to the runtime, listener or
  is disabled by an explicit native policy. Live Codex policy comes from the
  actual selected native thread, not a Crossfire default.
- Fleet validation rejects missing listener-mediated approval routing before
  enrollment. Shared listener readiness checks current applied grants, unmuted
  delivery, active identities, both joined members and native message powers.
- Readiness and `agent test` do not prompt a model. A configured but unauthorized
  approval conversation never reports ready or online.
- The permission broker returns expected failures through `Result`. The Codex
  adapter selects an exact offered native denial or cancellation; approval
  expiry, unavailable transport or lost authorization does not terminate an
  otherwise healthy session. Invalid native requests remain fatal.
- Only the verified owner can choose a native decision by replying to the exact
  pending request. The reply is consumed as control input, never model input.
- Runtime failure immediately makes the listener inactive. The controller keeps
  the bounded actual cause, preserves successful peers and excludes restart
  during failure cleanup. Secondary cleanup failure does not erase the cause.
- Git privacy checks retain the actual subprocess error and distinguish it from
  a genuine Git exit. Failed subprocesses never bypass private-storage protection.

## Reusable verification

Run the repository's normal gates:

```sh
npm run typecheck
npm run build
npm test
npm run verify:architecture
```

The focused cases live in:

- `services/crossfire/tests/permissions.test.ts`: native powers, exact owner,
  revoked authority, expiry, concurrent decisions and publication races.
- `services/crossfire/scripts/listener-permissions.test.ts`: missing or unusable
  routes cannot reach online readiness; owner decisions work while paused.
- `services/crossfire/scripts/native-tests/permissions.test.ts`: stock Codex with
  an inert local provider, actual native approval, forbidden/unavailable denial,
  following input in the same session, and an intentional Matrix reply through
  the verified project-local client in a Git-protected workspace.
- `services/crossfire/tests/client-state.test.ts`: real Git privacy and real
  missing/inaccessible executable diagnostics without credential creation.
- `services/crossfire/tests/release-awareness.test.ts`: complete installed client,
  strict live diagnostic contract, reconnection, upgrade and one receiver.
- `services/fleetd/tests/execution-validation.test.ts`: generic adapter approval
  capabilities without provider-key interpretation.
- `services/fleetd/tests/controller.test.ts`: actual failure causes, immediate
  inactivity, peer independence and cleanup/restart ordering.

Native fixtures explicitly unsubscribe their setup connection after the listener
subscribes. They do not leave a second client rejecting approvals, autoapprove a
request or assume a denial creates another provider response. Denial is proved
by native idle inspection, absent command effects and subsequent publication to
the same session. Approval and message output are separate observations.

## Native dependency

The Linux subprocess fix belongs in Codex's `linux-sandbox/src/landlock.rs`.
Removing the unconditional `SYS_shutdown` denial allows half-closing an existing
IPC descriptor. It does not create a connection. Network socket, connect,
send and io_uring restrictions remain enforced. Adjacent native tests cover Unix
half-close, denied network socket creation and real captured Node subprocess I/O
with input, output and exit-status preservation.

An isolated local patch against Codex revision `44fe510ce3` passes the complete
Linux sandbox bank: 224 tests passed and three existing platform cases skipped.
Restoring the stock shutdown rule fails the captured subprocess control with
`EPERM`. This is a local native-owner proof, not an upstream release or permission
to install a custom Codex binary. Crossfire includes no runtime patcher, alternate
Git spawn path, sandbox relaxation, system service or restart workaround.

The production fleet needs an explicitly selected authorized approval conversation
and an approved way to obtain the native sandbox fix. Passing inert-provider
tests does not certify paid-model work or restore a production deployment.

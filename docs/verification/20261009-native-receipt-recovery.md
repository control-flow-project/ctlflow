# Native receipt recovery release — 2026-10-09–10

Scope: Crossfire and fleetd, from merged main `a00817f`, on
`fix/native-receipt-recovery-order-20261009`. Bad Bets is excluded. Production
inspection was initially read-only. The owner subsequently authorized completing
the corrections, coordinated 0.1.17 publication and GAAP deployment. Preserve
verified production backups, identities, histories and stopped selections. No
reset, new business assignment or decision answer is authorized.

## Confirmed incident

Nell's exact saved native history and provider data remain retained. The pending
Matrix steering plan and native delivery journal agree on session, input ID and
text; this is not mismatched chat state or a history replacement.

| UTC time | Retained evidence |
| --- | --- |
| 11:30:06.712 | Previous native turn aborted after Karthik's accepted mention. |
| 11:30:07.981 | Replacement native turn started; its input receipt remained pending. |
| 11:30:40.613 | First management incident: `The operation was aborted due to timeout`. |
| 11:30:42.122 | Management DM prematurely claims `Native execution resumed`. |
| Subsequent recovery | Restart reminder uses a different ID while the original input remains pending, causing `Receipt recovery does not match the pending native input`. |

The native history includes the new turn start but no exact persisted user-input
receipt. These records do not establish why native materialization was slow.
There is no evidence here of lost history, a permission denial or a changed model.

## Owning defects and corrections

- **Shared listener:** a 30-second reconciliation/admission deadline incorrectly
  extended through durable native receipt settlement. Admission remains bounded;
  publication instead retains lifecycle, generation and explicit cancellation
  ownership, with bounded native transport requests. A pending receipt is not
  falsely accepted, failed or replayed when the admission interval expires.
- **Fleet continuation producer:** restart recovery attempted its reminder before
  settling the preceding input. It now uses the existing runtime settlement
  interface first, preserves original confirmed receipts for their producer and
  does not displace the original message with an unrelated reminder. If recovery
  already started a live continuation, another reminder is unnecessary.
- **Native lifecycle:** startup observations and recovery callbacks preceded
  continuation readiness. It retains actual initialization observations privately,
  stays waking and publishes ready states only after initialization succeeds.
  This also settles retained input when no unfinished-work reminder is needed and
  rejects a generation that ended during continuation receipt processing.
  Failure remains visible; successful callback delivery does not imply model-task
  completion.
- **Crossfire incident domain:** waking/sleeping metadata previously resolved
  failure incidents. Only ready states for the exact history resolve them now.
- **Native delivery owner:** mismatched recovery input was an untyped, retryable
  error. It is now a permanent conflict, with strict identity/content validation
  and unchanged evidence. Recovery cannot restart endlessly to bypass it.

The Codex adapter now handles the owner's explicit uncertainty policy: reopen
the same history, check the exact recorded input first, and if delivery remains
unknown on the idle restarted process, supply the original attributed input
through a private file in a new restart turn. The original text/identity remain
immutable. Its explicit resumption attempt records independent native correlation,
text, turn and boundary in the same publication journal before submission. Only
that attempt's exact receipt acknowledges delivery of the last-message context;
the original receipt is not invented. Native output reports this to the owner.
Repeated restart checks the recorded attempt before another submission. Live busy
input is not resubmitted on a timeout. Historical inProgress is not live activity,
and no old turn is interrupted after process death. Opening and readiness are
separate phases of one lifecycle owner, keeping live controls accessible.

One current implementation remains. No alternate cursor owner, native adoption,
history reset or timeout increase is introduced. Models, saved histories, access
policy and deliberate stopped selections are unchanged. The only dependency
addition declares an existing private workspace export used by fleetd tests;
external dependencies are unchanged.

## Verification

The original product reproduces the exact mismatch using its real native delivery
journal and fleet work store. Received, cancelled and interrupted settlement
cases all fail before the correction. The controlled-clock listener reproduces
the deadline failure, and the server incident test demonstrates the premature
waking recovery. Assertions, native deadlines and process resource limits are
not relaxed.

Focused tests cover exact original receipt before reminder, shared/per-room
ordering, retained evidence on unverifiable input, delayed receipt without
replay/false acceptance, initialization readiness, permanent conflicts and owner
incident behavior.
Additional regressions cover live interruption while recovery is preparing,
historical inProgress after process death, lost restart responses with and without
a retained receipt, interruption of the new restart notice, and large attributed
inputs passed through a private file. A real Codex process is killed while input
is queued, then the exact history is reopened and the last message is supplied
as context in a new turn. The test uses an isolated inert provider.

| Current-source gate | Result |
| --- | --- |
| Typecheck and build | Pass. |
| Focused native/control regression selection | 62 tests pass across seven files; subsequent full run includes the additional interrupted-restart case. |
| Full product tests | 789 tests pass across 174 files, 24 workers, 126,165 ms execution. |
| Architecture verification | 33 tests pass; native limitations remain explicitly characterized. |
| Installation verification | Four tests pass. |
| Container acceptance | Startup, Element room creation and authenticated attachment download, React/native routes, artifacts, shutdown and persisted rooms pass. |
| Dependency comparison with merged main | All 97 external dependency records unchanged. |

Full product evidence:
`.temp/test-runs/2026-10-09T18-54-15.138Z-723493/summary.json`.
Container evidence:
`services/crossfire/.temp/container-verification-W2m5jL`, image
`crossfire-runtime:50d2693f972fbc5bef57`. Aggregate resource limits are
24 GiB memory, no swap and 8,192 tasks; all runtime verification is Codex-only.
Source is unchanged during container build and acceptance.

The first release run has 15 failures. Twelve arise from a native fixture that
always reports idle even while its fake turn is running; it now reports actual
fixture activity. The native command test awaited an unrelated completion and
now waits for the actual command, output and idle state. Listener cancellation
now preserves its explicit lifetime reason instead of exposing a transport abort
error during shutdown. One test also exceeded its deliberately 100 ms native
transport deadline under the full run; its deadlines and assertions remain
unchanged and the complete subsequent run is green. These failures are retained
in `.temp/test-runs/2026-10-09T18-47-26.315Z-620146/summary.json`.
No assertion, deadline, resource bound or quality gate is weakened.

Regression checks are deterministic/inert-provider; native/container checks do
not certify paid-provider availability or every native failure. The reason for
the original slow native input materialization remains unproved.

## Production status

Predeployment inspection retains all 42 identities and exact native histories,
42 provider-file fingerprints, 29 desired-active bindings and 13 deliberate
stops. Nell remains failed on deployed 0.1.16, with shared history
`01a100ae-c94f-7a50-9eb7-1011fc52198f`. The management database snapshot is
schema 15, with 48 agent accounts/credentials and 64 room grants.

Coordinated 0.1.17 packaging and all source gates are complete. Publication,
verified fresh backups, production activation and postdeployment evidence follow
this release checkpoint. Passing source tests is not yet a claim that production
Nell recovered. Deployment results will be recorded here before the final handoff.

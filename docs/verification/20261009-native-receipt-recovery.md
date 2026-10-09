# Native receipt recovery release — 2026-10-09–10

Scope: Crossfire and fleetd, from merged main `a00817f`, on
`fix/native-receipt-recovery-order-20261009`. Bad Bets is excluded. Production
inspection was initially read-only. The owner subsequently authorized completing
the corrections, coordinated publication and GAAP deployment. Preserve
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

Final review reproduced a power-loss gap: a recorded restart receipt could
clear the original journal even if the private file containing the original
input was missing. Release 0.1.19 uses the existing filesystem adapter to
atomically write and flush the file and its directory entries before publication.
Reopening a recorded attempt rebuilds missing context from the retained original
input before checking its receipt. Changed, symbolic-link and nonprivate files
are rejected without replacing evidence. File-flush failure cannot expose a
partial published file. This is producer durability, not a second receipt owner.

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
inputs passed through a private file. Final durability regressions cover exact
file/parent flush ordering, interrupted flush cleanup, missing context with a
recorded restart receipt, and rejection of altered/symbolic-link/nonprivate files.
The missing-file/recorded-receipt regression fails against 0.1.18; all 15 focused
restart tests pass after correction. A real Codex process is killed while input
is queued, then the exact history is reopened and the last message is supplied
as context in a new turn. The test uses an isolated inert provider.

| Current-source gate | Result |
| --- | --- |
| Typecheck and build | Pass. |
| Focused native/control regression selection | 62 tests pass across seven files; subsequent full run includes the additional interrupted-restart case. |
| Full product tests | 796 tests pass across 175 files, 24 workers, 87,006 ms execution on coordinated 0.1.19. |
| Architecture verification | 33 tests pass; native limitations remain explicitly characterized. |
| Installation verification | Four tests pass. |
| Container acceptance | Startup, Element room creation and authenticated attachment download, React/native routes, artifacts, shutdown and persisted rooms pass. |
| Dependency comparison with merged main | All 97 external dependency records unchanged. |

Full product evidence:
`.temp/test-runs/2026-10-09T20-11-44.812Z-1140004/summary.json`.
Container evidence:
`services/crossfire/.temp/container-verification-SHmKh8`, image
`crossfire-runtime:a74dfb03b75a5fe383dd`. Aggregate resource limits are
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
The first 0.1.18 run has 788 passes and one package-ownership failure: workspace
development-dependency references in the lock still named 0.1.17. Those owned
references now match all 27 manifests. All 97 external dependency records remain
byte-for-byte equal as parsed records. The complete subsequent run and all gates
pass; evidence for the failed run remains at
`.temp/test-runs/2026-10-09T19-36-39.412Z-1018137/summary.json`.
No assertion, deadline, resource bound or quality gate is weakened.

Regression checks are deterministic/inert-provider; native/container checks do
not certify paid-provider availability or every native failure. The reason for
the original slow native input materialization remains unproved.

## Production status

Initial predeployment inspection retained all 42 identities and exact native histories,
42 provider-file fingerprints, 29 desired-active bindings and 13 deliberate
stops. Nell was failed on deployed 0.1.16, with shared history
`01a100ae-c94f-7a50-9eb7-1011fc52198f`. The management database snapshot is
schema 15, with 48 agent accounts/credentials and 64 room grants.

Release 0.1.17 is deployed with verified backups. Nell recovered on her original
history, and all 29 enabled listeners are connected with the 13 deliberate stops
unchanged. Production exposed one further owning defect: the controller applied
an inherited 30-second deadline to the whole restoration, including waiting for
the restart input to appear in Codex's history. It unnecessarily cancelled the
first generation. Automatic recovery then succeeded, with the exact restart
input recorded approximately 166 seconds after its turn was accepted. These
records do not establish the cause of that native delay.

Release 0.1.18 removes the overall restoration deadline at the controller owner.
Individual native requests remain bounded, at most four starts run concurrently,
and explicit stop/update cancellation retains exact generation ownership and
verified cleanup before replacement. The private controller API remains available
while startup waits for Codex. Readiness and errors now follow actual results,
not an arbitrary overall timer. No timeout increase or alternate runtime path is
introduced.

The original controller fails the controlled-clock slow-confirmation regression;
the corrected source passes 75 focused controller/lifecycle/recovery tests.
Explicitly cancelled late cleanup, slow permanent failures and shutdown draining
remain covered without weakening their assertions. Coordinated 0.1.18 source,
packaging, architecture, installation and actual container gates pass. Both public
packages are published and anonymous registry bytes/installations were verified.
GAAP server and turbine-gaap were activated after fresh verified preserving
backups. All 29 enabled listeners were online, all 13 deliberate stops and all
42 exact identities/histories/provider-file fingerprints retained. Nell completed
the recovered turn on her original history, then slept normally. Actual browser
checks covered 56 authenticated management routes and two picker viewports.
Canonical database preservation passed all 40 protected relations without an
exception; all 53 current accounts/credentials and 64 room grants remained.
The increase from 48 to 53 accounts was a concurrent human-created fleet, not
a deployment reset. Rootless container health and all security/provenance checks
passed. Release 0.1.19 closes the final-review durability gap described above.
Its typecheck/build, all 796 product tests, 33 architecture checks, four
installation checks and full container acceptance pass. All 27 owned manifests
and lock entries agree on 0.1.19; all 97 external records are unchanged. Public
package file inventories contain only their approved executables, integration
assets, licenses and documentation, with no private runtime dependency. Final
publication and preserving deployment evidence follow before handoff.

## Recovery cases

| Observed case | Required behavior |
| --- | --- |
| Accepted mention while Codex is working | Interrupt the actual live turn, then submit the attributed message. Human and agent sources use the same authorized path. |
| Codex restarted; original input is recorded | Load the same saved history, recognize the exact input and continue unfinished authorized work without blindly submitting it again. |
| Codex restarted; original input is not recorded | Start a new turn on the same history with a private file containing the exact last attributed input. Say that its earlier receipt is unknown; review history and effects before continuing. |
| Restart message is recorded but its response was lost | Recognize the exact recorded restart message, rather than inventing receipt of the original message or resubmitting another notice. |
| Process dies again before the restart message is recorded | Retain original input and separate restart-attempt evidence; use the same history and the same uncertainty rule on reopening. |
| Saved timeline says an old turn was in progress | Treat that as historical information, not a running turn in the new process. Never wait for that old process. |
| Input appears more than 30 seconds after submission | Keep the exact generation and wait for the actual receipt; do not cancel it or claim recovery on an overall timer. |
| Owner explicitly stops or updates during startup | Cancel and drain the exact generation before replacement. Preserve stopped intent and verified cleanup. |
| Native process or transport fails | Report the actual failure, preserve original evidence/history and retry recoverable failures under the existing lifecycle owner. |
| History, credentials, configuration or cleanup is invalid | Report the actual error. Do not invent a fresh history, approve a decision, accept a substitute identity or start a competing writer. |

Restarting is not rollback. Neither receipt checks nor a recovery instruction can
certify exactly-once external effects or provider availability. Recovery explicitly
asks the agent to inspect completed work before acting; it never supplies an
approval or fabricates knowledge that the original input was received.

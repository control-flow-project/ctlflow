# Native runtime behavior

fleetd owns native processes through runtime adapters. crossfire owns coordination,
authorization and observations; it never launches or kills agents.

Codex and Earendil Pi are implemented. Claude is rejected at configuration
boundaries. There is no terminal-scraping control channel or backend fallback.

## Settings and histories

A role definition supplies native defaults. Instance top-level settings override
them; nested tables replace whole values. The adapter resolves and validates the
same effective settings for inspection, startup, resume, recovery and reset.
Unavailable model/effort combinations fail before startup; no substitution occurs.

Codex requires stock 0.158.0+ and the actual native capabilities used by this
release, including developer-item injection. A version number alone is not proof.
Selected model/effort support is checked through native config/model APIs.
Managed defaults are danger-full-access and on-request approval unless explicitly
configured. A supported explicit bypass is a deliberate owner choice.

Each activation atomically refreshes provider authentication from the current
authorized host source. It does not import the setup assistant's history or
silently switch a running engine's account. Invalid private login files fail;
an absent source removes stale file login.

Instructions are receipt-confirmed native developer/custom entries with zero
model turns. Unchanged instructions do not append duplicates. Changed AGENTS.md,
skill or administrator text uses the same producer on the next eligible activation.

## Message delivery and interruption

The listener filters native Matrix events using current account, room, wake and
controller authority. Input contains verified instance/owner, exact event origin,
sender directory, room/event IDs and native time. Missing metadata is unknown.

Eligible native user mentions interrupt the exact captured active turn before
replacement input. Humans and agents have the same accepted-source rule.
Display names, quoted text, edits, old snapshots, self and internal notices do
not become controls. Shared context targets the shared history; per-room mode
targets only that room.

Steering bypasses ordinary collection/work queues. Cold startup still has a
finite native-start capacity; non-admission is visible and does not consume unread
input. The owner DM records receipt, interruption/already-idle and exact input
acceptance with measured timestamps. A delivered input receipt is not completed
model work. Cancellation does not roll back prior tool effects.

## Native input uncertainty

The adapter journals exact input identity/text and history boundary before sending.
Only an exact native receipt advances unread state. RPC success or a client
correlation ID alone is insufficient. Confirmed input survives restart without
replay; pending work is resolved before a new reminder/message.

A restarted idle native process has no previous running turn.
When its old receipt cannot be established, the exact old message is written to
a private file and referenced by a new correlated restart instruction.
The instruction says delivery was unknown and asks the model to inspect prior
effects before continuing. It does not claim exactly-once external execution.

Invalid/corrupt identity journals are permanent conflicts, not unlimited restart
conditions. Do not delete them to force a new context.

## Owner output and decisions

By default, visible non-thinking native output goes only to the verified private owner DM.
Reasoning traces, hidden protocol credentials and secret answers are excluded.
Shared-room replies require an intentional messaging-tool call with an explicit
destination. Terminal output never infers a public audience.

The owner is trusted to see this transcript, including shared-context information
from rooms they have not joined. This is not room confidentiality isolation.
Machine-specific paths may appear in that owner DM; agents are instructed not
to disclose them to other audiences. That instruction is not a guaranteed scrubber.

Native permission/questions use one decision port. Only the current owner can
answer the exact pending request. A choice URL is read-only; an authenticated,
same-origin/CSRF-protected submission is required. Silence is never consent.
Multiple questions require one complete answer set.

Pending, Answered, Responded, Cancelled and Expired have distinct meanings.
Responded records the original native socket-write completion, not proof of
subsequent model execution. Request-clear notifications can be cancellation.
Unsupported shell/TUI prompts are not guessed from prose.

## Activity, sleep and failure

Native state distinguishes idle, working, waiting, sleeping, waking, failed and
unavailable. Initialization stays waking until receipt/continuation readiness.
Unknown activity prevents automatic sleep instead of inventing idle.

Idle timeout defaults to thirty minutes. Busy contexts, questions, pending input,
startup/cleanup and uncertain receipts veto sleep. Eligible input resumes the
exact saved history. Explicit Stop cancels desired activation and stays stopped.

Unexpected failure closes the affected generation before bounded recovery.
Transient retries back off from one to sixty seconds; authorization/configuration
conflicts require action. Failed cleanup blocks a replacement writer.
The controller reports incidents to the owner's private crossfire management DM.
Lost contact is unknown execution state; a dead controller cannot report itself.

Every implementation's process adapter guards the owned native engine group
against controller death, including SIGKILL. Node uses its parent IPC connection,
C# an exact parent process handle and Rust an exact parent pidfd. The guard
holds the private native-group lock while terminating its group. The native
history lock also refuses a competing writer. These mechanisms do not contain
arbitrary subprocesses that escape the group.
A full host restart, where old processes are gone, is a different case.
No implementation scans process names, adopts an orphan or copies its history
to bypass ownership. Retained input and receipts still require recovery; process
cleanup is not evidence that an external action did or did not complete.

## Native terminal access

`fleet agent contexts FLEET INSTANCE` lists exact retained histories.
`fleet agent attach` returns a running-session command, not another process,
listener or forked history. The token itself is not printed. Closing the TUI
leaves the managed engine running.

Pi RPC does not support live TUI attachment. Its API returns unsupported without
starting a second writer. It has no emulated native permission sandbox; tools run
with controller-user privileges.

- [History and reset](history.md)
- [Fleet native options](../../fleet/docs/configuration.md)
- [Pi requirements](../../fleet/docs/pi.md)
- [Decision diagnosis](../../../docs/runtime-approval-readiness.md)

## Quiet native output

An operator can set `mirror_output = false` under an instance's
`[instances.listener_options]` in the fleet roster. The controller JSON field is
`listenerOptions.mirrorOutput`. The default is true. Use normal stop/resume after
changing configuration; retain the saved history. This disables automatic native
text/tool-result mirroring while keeping activity/usage reporting, approvals,
required decisions, explicit chat messages and important listener notices.
Detailed collection logs stay local. Agents must send important outcomes through
the explicit messaging tools because their terminal final answers are also quiet.
Already journaled output receipts retain their original publication semantics.

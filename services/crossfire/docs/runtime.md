# Runtime activity, histories and human decisions

## Activity versus connection

The agent's Runtime tab reports observed native state independently of listener
heartbeats: idle, working, waiting for approval, waiting for an answer, failed or
unavailable. Online is not evidence of progress. Offline observations describe
last reported state, not current native activity.

The page shows native runtime/version, original session, observation time,
history scope, instance inline-message limit and public runtime settings. Configured and
effective values are separate; missing effective values are unknown, not copied
from configuration. Credentials, private endpoints and decision answers never
belong in these projections. Software leads with the currently reporting
installed release and latest available release. Offline agents show a clearly
labelled last reported installation independently of the selected history page;
this is not a claim about a currently running listener. Historical runs are secondary,
paginated evidence, not current installation or outstanding-update claims.

## Messages and replies

Delivered chat includes the coordination instance and verified owner, native
room/event/sender IDs, native event time or explicit unknown, room/DM
classification, observable name/alias and verified sender relationships:
owner, owner's agent, other human, other owner's agent or unknown.
Names are labels, not authorization. External messages do not override system
instructions, extend permissions or authorize host changes.

Eligible wake-up input includes pending context. The full serialized UTF-8
envelope, including metadata and routing instructions, fits the configured inline
limit; larger messages/batches use private full-content files and a compact
manifest pointer. A response to a room or DM must be sent intentionally through the
Crossfire messaging tool using that input's explicit `room_id`. Neither terminal
text nor the latest typing destination determines its destination. Agents can
participate in several rooms without broadcasting their terminal output.
- [Message files, catch-up, historical pages and fleet resets](history.md)

## Terminal output and privacy

Observed native terminal-visible assistant text, command/file/tool output,
progress and errors go to the canonical private owner DM. Reasoning events,
protocol housekeeping and secret-answer fields do not. Text is literal, not
interpreted as Markdown or HTML. Large output is split into complete
native-sized messages with durable stable retry identities, not truncated to
an approval-display or incoming model-input budget.

**This intentionally shares room-derived content with the agent's owner even
when that owner is not a member of the room.** Invite an agent only if that
disclosure is authorized. Separate histories prevent conversational carry-over;
they do not isolate files, tools, credentials or same-user processes.

Machine-specific paths and diagnostics are allowed in that verified private
owner DM. Shared agent instructions prohibit disclosing execution-machine
home/workspace paths, OS usernames, private hosts/IPs/ports, internal endpoints,
socket/token paths, process/session identifiers, environment dumps or connection
strings in any other DM or room, even a private room containing the owner.
Use workarea-relative paths, neutral temporary references or authorized uploaded
attachments; label agent-local references because they do not grant file access.
Review reports, filenames, archive members, logs and metadata before sharing.
Intended public URLs, native Matrix identities and source citations are retained.
Private tool execution may still use absolute paths. Literal owner mirroring is
unchanged; credentials and secret answers remain protected everywhere. This is
agent communication guidance, not guaranteed model-output redaction or isolation.

The private owner DM opens on first actual owner contact, terminal output or
native human decision. Enrollment, startup, diagnostics and heartbeats create
no chat. Native names identify the agent; an existing human-assigned title is
kept. Established read/reply access cannot be muted, downgraded, removed or
delegated in management. Suspension/revocation remain authoritative.

The private output queue is bounded to 64 MiB. Exhaustion is an explicit failure,
never silent deletion. Observation covers events actually exposed by the native
adapter, not hidden subprocess output or guessed terminal prompt semantics.

## Native human decisions

Supported Codex requests become one normalized decision resource bound to the
original agent, listener run, native session, turn, item and request. Command/file
permissions retain complete review scope and choices. Structured questions
retain IDs, option labels/descriptions, free/secret-answer flags, blocking state
and native deadline. A pending nonblocking question does not imply stopped work.

The owner DM offers review links and native choice links. Opening a link only
reads; a suggested choice is not preselected or submitted. The currently
authorized owner explicitly submits a complete authenticated, CSRF-protected
form. All questions in a native request are answered together. Password-style
secret answers never appear in DM, audit, activity or human GET responses.

Only the verified owner can answer. Administrator status, another human/agent,
silence, an unrelated DM reply or an expired request is not consent. There is no
parallel reply-to-message approval path. Ordinary code returns the exact native
response to the original pending request without a new prompt or model polling.
It does not resume unrelated paused chat. Responded means native socket-write
confirmation, not proof of continued/completed work. Cancellation, expiry or
session replacement cannot retarget an answer.

Codex Default-mode structured questions require the explicit native feature
`features.default_mode_request_user_input`. It is under development, not enabled
globally. Enabling it in a fleet checks the selected binary's `codex features
list` before startup, in addition to the baseline stock Codex 0.158.0+ requirement.
Missing capabilities fail explicitly; there is no silent disabling or emulation.
Actual question/answer/continuation is verified on Linux with an inert provider;
that does not certify paid models or macOS. Native questions may be nonblocking
and expire. Attached sessions retain their native settings and policy.

Claude Code and Pi retain native permission handling; their adapters do not
emulate Codex-specific requests or arbitrary interactive stdin. Prose questions
can be mirrored and answered through ordinary chat or a native terminal, but
receive no invented native-decision links.

## Fleet histories

Directly connected agents retain their one existing history. Fleet instances
default to `history_mode = "shared"`: rooms, DMs and private operator input
share one saved native history, like a human retaining context.

`history_mode = "per-room"` gives each native room ID its own persistent history
and gives non-chat operator/fleet/scheduled/maintenance input a separate private
control history. This is one identity and running instance, not another agent
per room or a fresh history per message. Returning to a room resumes its history.
Decision responses always target their original request/context.

Shared Bea can use information learned in Samosas in another room. Per-room Bea's
second-room conversation does not contain Samosas's chat; files and tools still
use the same workarea. Terminal output always goes to Bea's owner.

Stop/start applies native and listener options. History changes never copy,
merge, fork or replay old history. Unconfirmed publication and pending decisions
block a mode switch. Original room/shared/control histories and cursors remain
intact for deliberate reuse.
- [TOML configuration and limits](../../fleet/docs/configuration.md)
- [Exact-context terminal attachment](../../fleet/docs/remote.md)

## Typing

Element's shared English activity indicator says “is thinking …” (or “are
thinking …” for multiple people), using its native translation override. This
wording applies to agents and humans; the underlying Matrix state is unchanged.

Typing targets the latest room/DM whose chat actually reached this runtime.
New delivered chat clears/moves it and starts one native 30-second lease.
Continued work, heartbeat polling and decision waits do not renew it. Completion,
interruption and listener disconnection clear it earlier. Typing is neither
reply attribution nor proof of completed work.

## Failures and diagnosis

Each member has one lazy private **Crossfire** management DM, separate from
individual agent DMs. Confirmed failures and lost contact produce durable,
episode-deduplicated notices with agent/controller identity, observation time
and management links. Lost contact is unknown execution state, not a confirmed
crash. Meaningful recovery produces an update. Failed delivery retries after
connectivity returns; a total outage cannot deliver an immediate notice.

Idle, decision wait, deliberate stop and fleet deactivation are not crashes.
The controller reports failure and retries transient faults after exact owned
process cleanup, with bounded backoff and the same deployed parameters/software/
history. Permanent authority/configuration errors require operator action. It
never silently replaces history, upgrades software or replays uncertain
input. One failed agent does not stop healthy peers. Avoidable protocol failures
are fixed at their native adapter owner.

For a missing response, check account and native read/reply access, wake sources,
mute/owner pause/fleet gate, Runtime/Decisions and receipt-confirmed Activity.
Obtain the exact native terminal pointer and inspect the original error before
deliberately restarting. Printed terminal answers are private owner output, not
room replies. Retired-room visibility on an existing Element device needs that
device's evidence; a fresh clean browser is not proof of repair. Do not reset
production databases, discard history or guess a cache workaround.

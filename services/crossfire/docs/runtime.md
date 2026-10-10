# Runtime activity, histories and human decisions

## Activity versus connection

The agent's Session view reports observed native state independently of listener
heartbeats: idle, working, waiting for approval, waiting for an answer, sleeping, waking, failed or
unavailable. Online is not evidence of progress. Offline observations describe
last reported state, not current native activity.

Managed native sessions sleep after 30 idle minutes by default while fleetd's
agent bindings remain connected. Crossfire's Policy page owns the instance-wide
timeout; zero disables sleep. Eligible chat/scheduled/fleet input resumes the
exact saved native history. Pending decisions, receipts, input, other busy
histories or unknown activity prevent sleep. Explicit Stop sessions prevents
automatic wake/recovery, including after controller restart. Session shows last native activity
and history availability independently of heartbeat freshness.

The page shows native runtime/version, original session, observation time,
history scope, instance inline-message limit and public runtime settings. Configured and
effective values are separate; missing effective values are unknown, not copied
from configuration. Credentials, private endpoints and decision answers never
belong in these projections. The Settings software section leads with the currently reporting
installed release and latest available release. Offline agents show a clearly
labelled last reported installation independently of the selected history page;
this is not a claim about a currently running listener. Historical runs are secondary,
paginated evidence, not current installation or outstanding-update claims.

## Messages and replies

### Managed instructions

Role, installed skill and administrator instructions use one adapter-owned
native instruction producer for new and resumed histories and changed revisions.
For Codex it invokes supported `thread/inject_items` with a real native
`role: "developer"` message containing `input_text`, not a disguised user prompt
or a model-dependent setting. This creates no turn/model call and persists in
the exact native history.

The private journal compares a stable content digest and confirms the exact
session/history/item ID, developer role and text. Unchanged confirmed instructions
are not appended again; lost replies require receipt recovery before any append.
Confirmed revisions require no growing-history rescan. Pending recovery scans
the fixed post-publication snapshot with bounded chunk/record memory.
Changing skills/roles uses this same producer, never a direct native-history edit
or settings-update fallback. These receipts do not consume unread Matrix input.
Native capability inspection rejects a binary without the required method before
enrollment/start; there is no guessed additional minimum version. Stock Codex
0.160 Linux source verification with Sol/max settings and an inert provider
confirms zero-model creation, exact resume and changed native developer items.
Installed-release gates remain the integration owner's responsibility; this is
not macOS or paid-model certification.

### Delivered context

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
and expire. Native provider restrictions remain authoritative.

Codex is the only implemented runtime; unsupported runtime values fail validation.
The adapter does not emulate arbitrary interactive stdin. Prose questions
can be mirrored and answered through ordinary chat or a native terminal, but
receive no invented native-decision links.

## Fleet histories

Every instance defaults to `history_mode = "shared"`: rooms, DMs and private operator input
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

One private `.codex/crossfire-context-registry.json` records the current mode and
unique shared/control/room bindings to exact native session UUIDs. Every context
uses the same registry, receipt naming and create/resume implementation. Old
split metadata is rejected, never silently read, guessed or replaced. Explicit
locked conversion preserves original bytes and native histories.
- [Context storage and forward conversion](../../fleetd/docs/storage.md)
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
"Native execution resumed" requires a ready observation from the exact native
history. Sleeping, waking and unavailable observations do not resolve a failure.
fleetd withholds startup idle/working/waiting states until original input receipts
and restart-continuation readiness are settled. A connected process alone is not
successful recovery.

Idle, decision wait, deliberate stop and fleet deactivation are not crashes.
The controller reports failure and retries transient faults after exact owned
process cleanup, with bounded backoff and the same deployed parameters/software/
history. Permanent authority/configuration errors require operator action. It
never silently replaces history, upgrades software or blindly repeats uncertain
input. A restarted idle Codex process with an unverifiable last message gets a
new turn: the exact last input and attribution are saved in a private file, and
the notice asks it to review history and existing work, avoid repeating completed
actions and continue unfinished authorized work. The new notice has its own
durable correlation and exact native receipt; the original receipt remains
unknown, which is reported in the owner DM. Another restart verifies that notice
only after restoring and validating its exact private input file. The file and
its directory references are flushed before publication; missing context is rebuilt
from the retained original input, while changed or unsafe files are rejected.
It checks the exact receipt before submitting anything else. Large original inputs stay in the file rather
than inflating the restart turn. No question or permission is approved.
One failed agent does not stop healthy peers. Avoidable protocol failures
are fixed at their native adapter owner.

For a missing response, check account and native read/reply access, wake sources,
mute/owner pause/fleet gate, Session decisions and receipt-confirmed Activity.
Obtain the exact native terminal pointer and inspect the original error before
deliberately restarting. Printed terminal answers are private owner output, not
room replies. Retired-room visibility on an existing Element device needs that
device's evidence; a fresh clean browser is not proof of repair. Do not reset
production databases, discard history or guess a cache workaround.

"Receipt recovery does not match the pending native input" means a producer
attempted recovery with different input while an original publication remained
unsettled. This is a permanent identity conflict, not permission to remove its
journal. Recovery checks the original input first; on a restarted idle process,
the approved last-message continuation resolves delivery through its own exact
receipt without claiming the earlier turn received it. A historical inProgress
label does not mean work is running after process death. thread/resume reopens
history; turn/start starts new work. Only a live running turn is interrupted.
Opening that exact native process and preparing it for new input are separate
phases of one owner, so live controls cannot be blocked by earlier-message checks.

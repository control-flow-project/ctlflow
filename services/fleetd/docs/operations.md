# Controller operation

`enroll` is a private whole-fleet operation on a stopped registration. It runs
the ordinary enrollment prepare/review/exchange but never enables delivery,
records active intent or starts/resets native sessions. Existing histories and
session identifiers are retained. The CLI exposes it as `fleet enroll FLEET`.
Name changes use that same human-owner-reviewed request, not another rename API.

Start through `fleet daemon start` or directly:
```sh
fleetd --name laptop --root /absolute/private/controller
```

The private root contains descriptor, registry, desired binding intent, operation state, log and
`fleetd.sock`. It binds a private Unix HTTP socket, not a public network port.
One root has one stable controller name. Optional metadata is descriptive and
contains no credentials.

Register explicit fleet directories; there is no filesystem discovery. Directories
may be outside the root. Invalid, symlinked or unowned private state fails.
Private SQLite exclusive transactions own daemon and fleet/receiver lifetimes.
OS locks survive suspension and release on process exit; no timeout lease or
process-name scan decides native ownership.

## Private API

Resources include `/api/setup`, `/api/status`, `/api/fleets`, nested fleet `/agents`,
`/delivery`, `/messages`, fleet `/readiness`, `/api/operations` and agent
`/attachment`/`/contexts`. Setup and update use these domain operations, not CLI
native-process orchestration. `GET /readiness` checks the actual shared listener's
model-free diagnostic and never starts a stopped controller/session.
Local and SSH CLI commands use the same typed requests. UUID operation keys and
expected revisions reject conflicting reuse. Accepted operations continue after
CLI disconnect and have per-instance outcomes.

Attachment returns a current running-session pointer to the shared terminal
adapter. It carries a private token-file path, never the token. Connection data
does not belong in public fleet views or durable registry restart authority.

Contexts lists saved native histories even while stopped or sleeping. Attachment
can select one exact listed context; neither endpoint creates a room/history,
writes state or starts an engine. Sleeping attachment returns an explicit
conflict. Room and private-control histories remain runtime-adapter owned.

## Idle sleep and restart

fleetd itself hosts the shared listener core. It is not accompanied by a fleet
listener subprocess. Agent identities, permissions, unread positions and
receipts remain independent. One shared control server and finite acquisition,
publication and native-start budgets bound aggregate work.

Crossfire's instance policy defaults to sleeping owned native sessions after
30 minutes of inactivity. Zero disables sleep. All histories must be confirmed
idle; pending input, decisions, receipts, initialization, cleanup or unknown
native activity prevent sleep. Heartbeats and policy checks do not count as work.
Sleep closes the owned native process, not its listener/controller connection.
Eligible room, DM, scheduled or broadcast input resumes the exact saved history.
The independent coding session performing setup is not owned by fleetd.

`desired-intent.json` in the private controller root durably owns active binding
intent. Start persists it before activation; explicit Stop removes it before
cleanup. Normal daemon shutdown preserves it. Start the same controller/root
after a restart or power failure to restore desired bindings and exact histories,
without re-enrollment or synthetic prompts for idle histories. Interrupted work
receives a receipt-confirmed continuation in its exact saved context. It answers
no question and approves no permission. The inserted message asks the agent to
re-read applicable AGENTS.md files and follow their current instructions before
continuing authorized unfinished work. Restoration may leave idle native processes
sleeping until input arrives. Manually stopped agents remain stopped.

Fleet Stop first saves its enabled targets in `resume-selections.json`. Fleet
Resume restores those targets plus current active intent. Individual Stop removes
its target from the saved selection; an empty saved set remains empty, and a
repeated fleet Stop does not erase the previous stopped selection. Initial explicit
startup without any saved selection or active intent uses the configured roster.
Fresh-history reset keeps its explicitly confirmed whole-fleet or agent scope.

Per-agent `resume-work.json` stores only unfinished context/session IDs, checkpoint
times and delivery receipts. Working/waiting observations create it, unchanged
observations do not rewrite it, and idle completion clears it. Close and abrupt
death retain unfinished work for the next exact-history activation. Resumed work
waits for listener policy, reporting and tool readiness. It cannot auto-approve
questions, invent a chat destination or cross room histories.
Fresh reset archives these checkpoints. Native receipt recovery prevents duplicate
continuation notices; it cannot certify exactly-once external task effects.

Startup restoration is bounded and generation-fenced. Missing histories,
unreviewed configuration, invalid intent or failed process cleanup remain
visible errors; they never authorize a new history or overlapping native owner.
Explicit lifecycle operations retire the same instances' queued restoration
ownership and drain started generations before replacement. Late restore results
cannot overwrite the new generation or start a competing owner.
The private controller API opens independently of native restoration. Queued
desired agents show `starting`; status and explicit stop remain available even
when a large fleet's native starts are delayed. Controller API availability does
not prove listener readiness: setup and `fleet test` check actual receivers.
Read-only inspection never accepts changed files or increments revisions.
Use an explicit revision-checked start/reset to apply configuration changes.
No automatic host boot service is installed.

### Abrupt controller death

Orderly controller shutdown terminates the dedicated group containing its owned
Codex launcher/native engine and awaits closure, with a three-second kill escalation.
Launcher exit alone does not prove its working child stopped. No process-name
scanning or unrelated processes are involved. A full machine
restart or power failure ends that engine; the same private root and workareas
retain desired activation and saved histories for normal restoration.

Killing only fleetd with `SIGKILL` does not provide the same guarantee. The verified
stock Codex WebSocket app-server can survive its controller and keep an active
writer for the exact native history. A replacement rejects the conflicting
writer. This prevents two owners, but is not successful automatic recovery.
It is an owned-engine lifetime limitation, separate from detached tool children.

Inspect the reported native error and safely stop the verified orphaned
app-server on its owning machine. Preserve the controller root, native home,
workarea, identities and histories. Normal restoration or explicit Resume can
proceed only after native writer ownership and ordinary receipt/history checks
succeed. Never delete lock/history state to force replacement, guess processes
by name or PID, adopt the orphan, or use fresh history as an implicit recovery.
There is no substitute supervisor, emulated native transport or hidden fallback.
Linux inert-provider verification does not certify abrupt-death recovery or
macOS behavior.

Unexpected startup/listener/native failures are recorded in each fleet's private
`.fleet/failures.json` before reporting through its scoped controller credential.
Delivery retries independently of listener activation; reporting errors remain
visible. Crossfire owns normalized episodes and management-DM notifications.
Deliberate stop/deactivation is not a failure. Transient native/listener failures
are recovered after exact owned-generation cleanup with exponential one-to-sixty-
second backoff. Native recovery replaces only its native generation, not the
stable receiver. Deployed configuration and installed software remain unchanged;
successful peers and saved native histories remain intact. Stop cancels pending
recovery. Failed cleanup or permanent configuration/authorization failures prevent
unsafe restart and remain visible.

Transport cancellation is not an owner stop. Controller lease replacement pauses
delivery and creates a new immutable reporting run on reactivation, retaining the
same logical receiver, account, native histories and unread checkpoints. This
also applies when pause and resume arrive before the receiver observes the pause.
Queued publication is canceled without dropping messages. Empty reconciliation
checkpoints settle while sleeping without starting a native process.

DOM AbortError/TimeoutError and Node transport cancellation/network failures retry
while desired intent remains active. Explicit Stop cancels recovery; authorization,
invalid saved state, missing histories and unknown coded failures remain visible
and require correction. No failed cleanup permits an overlapping process.

Native-stop proofs belong to their original controller generation. A historical
proof cannot authorize retirement after reconnect, but also cannot mark a healthy
new connection as failed or cause an endless stale-proof reporting loop. Resume
and stop the current binding explicitly if retirement needs current native evidence.

An explicit `reset` operation targets one enrolled instance or all fleet instances.
It stops selected owned processes before resetting any history, then exports and
verifies all available authorized Matrix room history and
nonsecret configuration, archives original listener/context state and starts fresh
history with unchanged identity/current native parameters. Durable reset phases
and operation IDs protect interrupted preparation. Normal recovery is not reset.
Default start requires saved native history unless first enrollment or an explicit
reset authorized initialization; losing established bindings cannot create new
contexts. A failed instance does not discard successful peers' outcomes.
- [Context reset contract](https://github.com/control-flow-project/crossfire/blob/main/services/crossfire/docs/history.md)

## Crossfire connection

Each approved registered fleet keeps an authenticated bounded long-poll connection
to Crossfire, including while stopped/deactivated. Loss closes delivery gates;
reconnect uses a fresh lease generation and current server intent.
Scoped controller credentials cannot approve identities, change room/wake
permissions, manage another fleet or act as human credentials.

Deactivate retains engines/sessions/controller connection; Stop ends owned
listeners and processes. Every receiver is fleet-bound. Ordinary models do
not enroll, poll for work, send telemetry or maintain controller credentials.
Management session requests arrive through this same connection. A separate
worker claims the current lease generation and calls the existing durable
lifecycle domain, so long native operations do not block lease renewal. Receipt
uncertainty retains the identical operation ID and pins its native outcome until
acknowledged. A restart marks unfinished operations failed; it never guesses or
replays destructive work under a replacement ID.

Local stop reports exact authenticated listener-run and controller-generation
evidence only after listener settlement and awaited native close. At most one
pending proof per current fleet member is retained; retries keep its receipt ID.
Proof-report failures remain visible separately from native-cleanup failures and
do not block automatic native recovery. New authenticated activity invalidates
older proof. A lost controller generation requires a current binding's explicit
resume/stop before retirement; no stale lease or sleeping heartbeat proves stop.
Instance retirement and fleet archive use the same canonical server operations
and fail closed until actual native stop and all outstanding decisions/input
receipts are confirmed. Neither operation detaches an agent or deletes history.
- [UI/CLI session controls and confirmation](https://github.com/control-flow-project/crossfire/blob/main/services/fleet/docs/sessions.md)

Role `coordination_options` requests exact Crossfire wake rules and invitation
defaults with initial or explicit enrollment. Owner review is required for new/changed settings;
the controller credential cannot approve them. Approved settings apply through
Crossfire's normal wake and room-access domains, not controller-side permissions.
Ordinary resume validates the existing approved roster and accounts without
requesting enrollment or writing policies. UI-edited wake rules and permissions
remain intact. Invalid credentials, inactive accounts or mismatched saved
identities fail rather than requesting replacement authority.
- [Configuration, approval, admission and removal](coordination.md)

## Source ownership

- `apps/daemon`: Unix HTTP and composition.
- `packages/domain`: operations, registry and execution lifecycle.
- `packages/contracts`: validated routes, requests and responses.
- `packages/storage`: private atomic controller/fleet state.
- Crossfire packages: listener, enrollment, permissions and native runtime adapters.

Runtime option interpretation stays in its adapter; controller code consumes
declared capabilities and validated native options. Orderly shutdown stops owned
listeners/engines and preserves desired intent for restart. Crash-proof
tool-descendant supervision is not promised.
No global service, host installer, privileged daemon or alternate listener exists.

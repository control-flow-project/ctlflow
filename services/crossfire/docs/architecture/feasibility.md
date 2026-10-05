# Native boundaries

## Supported architecture

Every operational agent belongs to a fleet. fleetd embeds Crossfire's shared
listener and owns native lifecycle through a functional runtime adapter. The
coding assistant performing setup is independent; no process scan, current-session
attachment, imported history or alternate transport is a setup mechanism.

Codex 0.158.0+ is the only implemented runtime. Unsupported runtime values fail
configuration validation; no placeholder integration or alternate-runtime test
flag remains. Portable ownership primitives support Linux and macOS, but recorded
native certification is Linux with an isolated native home and inert local
provider. This does not certify paid models, arbitrary subprocesses or macOS
hardware.

## Controller-owned Codex

The Codex adapter validates the installed executable, selected features and
provider prerequisites without a model call. It launches stock Codex with a
private authenticated loopback WebSocket and creates or resumes the exact saved
native history. Role/model/reasoning/permission settings reach native thread
configuration directly; the daemon does not interpret provider-specific settings.

The mandatory private instance `stateDirectory` owns credentials, delivery state,
tool release and native home. Native cwd normally uses that work area, or an
optional validated `workspace` references an existing project. Both use the same
private state owner. `CROSSFIRE_PROJECT` points intentional tools to that state;
cwd is not identity discovery. First-use provider/model configuration and private
login may be copied into the managed home, but coding-session histories, workspace
trust and approval bypasses are not. Subsequent starts use retained private state.

An initial native history read materializes a new empty session without synthetic
input, so zero-turn startup can later resume. Existing saved histories are never
silently replaced. Shared mode uses one conversation across eligible rooms/DMs;
per-room mode selects distinct retained native histories behind the same agent
binding. It does not create another agent/process per room or replay one history
into another.

Native input acceptance is not delivery confirmation. The adapter journals exact
publication intent before input, then verifies the native user-message receipt
and content. Lost responses require receipt-only recovery, not another submission.
The same confirmed receipt advances Matrix unread positions. Busy native state
retains pending input; it does not inherit a guessed short turn deadline.

Pending native decisions are typed exact requests, not parsed terminal prose.
Only the verified owner answers through authenticated review. GET links,
unrelated chat and administrator status cannot approve another owner's request.
The adapter returns the exact offered choice or structured answer to its original
native session/turn/item/request. Unsupported interactive stdin has no invented
approval links. Complete file/activity notifications are not bounded by chat
or permission-display limits.

## Lifecycle and terminal inspection

Orderly stop closes exact owned listener bindings and native processes while
retaining history. Transient failure recovery first verifies cleanup, then resumes
the same parameters, installed release and receipt state with bounded backoff.
Permanent authority/configuration failures require action; uncertain cleanup
cannot start a competing engine.

Idle sleep defaults to thirty minutes and stops native processes only after every
history is confirmed idle with settled input/publication/decisions. fleetd remains
the listening process and can resume the exact saved history on eligible input.
Explicit Stop sessions removes desired activation; incoming messages and controller
restart cannot override that intent. No boot service is installed automatically.

Private terminal attachment is inspection of an already running exact native
context. The adapter supplies the executable, native home, run-local token-file
reference and endpoint; no secret is printed. SSH runs that same command on the
controller host with normal host-key verification. Inspection never starts an
engine, listener or conversation, and TUI exit leaves the controller's engine
running. Sleeping/stopped contexts require explicit Resume first.

Retirement/archive require settled decisions/wake/message receipts and actual
native-stop evidence for an exact current lease/run. Sleeping, lost contact or
a database reporting stop does not prove cleanup. The current native observation
invalidates earlier stop evidence. Historical identity/binding/native files remain
retained; decommissioning never converts an agent to an independent listener.

## Conduit

The pinned Conduit image is `v0.10.14`, digest
`f13263ad11be1f41cc4d89d8ee0f4ccbcc846efacf51abab2d859e073faef642`.

Accepted native semantics:
- Authenticated accounts, including agents, can create rooms through native
  Matrix without homeserver-admin promotion. This is not a Crossfire room-creation
  feature. Enrollment joins/creates no rooms; private admission stays enforced.
- Public joining/creation is not blocked by the periodic grant sweep. Power
  levels deny ordinary messages, reactions and administrative changes; native
  typing can still succeed for a read-only member.
- Human and agent accounts are independent. Crossfire applies explicit access
  intent and reconciles downward drift, default every 300 seconds.
- Kicks stop new private-room messages but may preserve earlier authorized
  server history. Known room IDs can expose creation metadata.
- Authenticated accounts knowing a media URL may download it without room
  membership. Native media is not a per-room file ACL.
- Native display names are mutable; immutable Crossfire ownership and configured
  presentation remain separate.
- Native presence reads are unreliable. Management uses explicitly labelled
  listener heartbeats, never inferred Matrix presence.
- Account deactivation invalidates password login/tokens. Revocation differs
  from removal from a room.

These are native product boundaries, not promises of stronger confidentiality.
Separate histories do not isolate shared workarea files, tools or an unrestricted
OS user. Public reports remain public regardless of their unguessable link.

## Verification owners

Protocol and lifecycle evidence belongs to maintained native/runtime tests,
not a launcher demo or documentation assertion:
- `tests/native-owned-runtime.test.ts`: headless ownership, zero-turn persistence,
  settings and exact resumption.
- `tests/native-prerequisites.test.ts` and `tests/codex-owned-options.test.ts`:
  executable/provider/features and native configuration boundaries.
- `tests/delivery-journal.test.ts`: exact publication/lost-response evidence.
- `tests/listener-host.test.ts`: bounded shared-host receiver ownership.
- `tests/fleet.integration.ts`: compiled CLI, daemon, Conduit and stock Codex.
- `scripts/native-tests/`: inert-provider input, busy/interrupt/command and
  verified-owner decision protocol.
- `tests/native-core.test.ts`, `tests/native-delivery.test.ts` and
  `tests/owner-conversation.test.ts`: native grants, attribution and private DMs.
- `tests/browser.test.ts` and `tests/fleet-browser.test.ts`: real management flows.
- `tests/schema-migration.test.ts`: deployed-schema conversion and preserved state.
- `tests/operator.test.ts` and `scripts/architecture-proof/`: build/owner boundaries.

Every delegated build/test runs in a verified finite process-group scope. Actual
integration evidence must identify the source, native binary, platform and
provider scope. A passing native characterization does not imply a stronger
guarantee, registry publication, deployment or real-model certification.

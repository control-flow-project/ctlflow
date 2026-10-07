# Fleet configuration

## Files and ownership

```text
research/
  runtime.toml
  rooms.toml
  agents/
    analyst/
      agent.toml
      AGENTS.md
      workarea/
        analyst-east/
        analyst-west/
```

A definition owns native settings/instructions. Instances share a definition,
not mutable sessions or work areas. Different native settings require different
definitions; listener history settings belong to each roster instance.
The fleet's private `.fleet` state holds bindings, desired enrollment and reset
evidence. Each instance's private workarea holds `.codex` native provider/history
and `.crossfire` delivery/tool state. Never commit private state.

## runtime.toml

```toml
fleet = "research"

[coordination]
adapter = "crossfire"
server = "https://YOUR_SERVER"
owner = "@YOUR_ACCOUNT:YOUR_SERVER"

[[instances]]
key = "analyst-east"
name = "analyst-east"
definition = "analyst"
workarea = "agents/analyst/workarea/analyst-east"

[instances.listener_options]
history_mode = "shared"

[[instances]]
key = "analyst-west"
name = "analyst-west"
definition = "analyst"
workarea = "agents/analyst/workarea/analyst-west"

[instances.listener_options]
history_mode = "per-room"
```

Keys/names start with a lowercase letter, contain lowercase letters, digits or
hyphens, and are at most 40 characters. Instance names, keys and work areas must
be distinct. Work areas are non-overlapping relative children of
`agents/<definition>/workarea/`; symlinked or unsafe private paths fail.

Optional `workspace = "/absolute/project"` on an instance changes only the native
cwd. It defaults to that instance's private workarea. It must be canonical, owned
and not writable by other users; existing project modes are not tightened.
Private state remains in the workarea, passed separately to the native adapter as
`stateDirectory`. The adapter's private native home retains the managed histories
and intended provider configuration, without overwriting or
importing the project's `.codex/config.toml`, history or coding session. Role
instructions, administrator setup instructions and the pinned Crossfire skill
are delivered via native developer instructions on both create and resume;
external cwd does not rely on private workarea ancestor skill discovery.

Every native start/resume, including automatic wake and recovery, atomically
recopies the current host Codex `auth.json` from `CODEX_HOME` (default `~/.codex`).
Sign in with `codex login` on the controller host before resuming. Changing that
host login changes the provider account used on subsequent activations, not the
agent's Matrix identity or saved conversation. Already-running engines retain
their current login until stopped/resumed. Preflight checks the host login and
does not rewrite running agents. Invalid or unsafe source files fail before
startup; absence removes the stale file copy rather than reusing it. Native
environment-only provider authentication does not require a file login.

Default project setup generates this same roster with one `project` definition,
the chosen project as `workspace` and a stable private workarea. Definitions
without `workspace` keep their original private cwd; this is one configuration
model, not another deployment mode.

The coordination block supplies server/owner once. It contains no approval room,
runtime transport, session UUID or secret. The private owner DM opens automatically
on first owner contact, terminal output or native decision, not at fleet startup.

### Listener options

| Field | Accepted values | When omitted |
| --- | --- | --- |
| `history_mode` | `shared`, `per-room` | `shared` |

Crossfire instance policy owns the incoming inline-message threshold, default
65536 UTF-8 bytes, including origin and verified sender metadata. It applies to
every agent and is not a roster override. Larger messages/batches use complete
private files and a compact manifest pointer. Ordinary native tool/file output
uses separate protocol and owner-output resource bounds.
- [Message files, catch-up and reset](https://github.com/control-flow-project/crossfire/blob/main/services/crossfire/docs/history.md)

Shared history preserves context across all rooms, DMs and private operator
input. Per-room history retains one exact native conversation per room ID and a
separate private control history for fleet messages, schedules and maintenance.
It is the same process, workarea and identity. Returning to a room resumes its
history, not an empty conversation. Files/tools/credentials remain shared;
terminal output still goes privately to the owner. This is not a security sandbox.

Listener changes apply on stopped-to-running transition. A pending publication
must finish receipt recovery before its history configuration changes.
History-mode changes preserve old sessions/cursors without copying, merging,
forking or replaying them. Pending native decisions also prevent a mode switch.

## agent.toml

```toml
name = "Research analyst"
runtime = "codex"

[runtime_options]
model = "YOUR_SUPPORTED_MODEL"
model_reasoning_effort = "high"
sandbox_mode = "danger-full-access"
approval_policy = "on-request"

[coordination_options]
wake_mode = "selected"
permissions = ["room.agent.invite"]

[[coordination_options.wake_senders]]
matrix_user_id = "@owner:YOUR_SERVER"
include_agents = true
```

The roster's optional workspace, or private workarea by default, supplies native
cwd. The companion `AGENTS.md` supplies
role instructions. The functional Codex adapter alone validates/translates native
options; fleetd does not interpret Codex-specific settings.

The role's separate `coordination_options` declares Crossfire wake authority and
invitation defaults for every instance. Owner approval applies the exact policy
to current ordinary grants and future admissions without another setup step.
Omitting the whole block requests an explicit person-only selection for the
actual configured owner and no invitation delegation. Each selected person can
include their currently owned agents. Multiple entries combine; individual
agents require `include_agents = false`. Use `wake_senders = []` for no entries.
Changed coordination policies require explicit `fleet enroll` while stopped and
owner review. Ordinary restarts validate existing identities and preserve live
wake rules and manual room-specific edits. Configuration grants no room membership
or native power.
- [Fields, selected identities, approval and removal rules](https://github.com/control-flow-project/crossfire/blob/main/services/fleetd/docs/coordination.md)

| Field | Accepted values | When omitted |
| --- | --- | --- |
| `model` | Nonempty native model ID, up to 200 characters | Native provider/config selection |
| `model_reasoning_effort` | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | Native config selection |
| `sandbox_mode` | `read-only`, `workspace-write`, `danger-full-access` | `danger-full-access` |
| `approval_policy` | `untrusted`, `on-failure`, `on-request`, `never` | `on-request` |
| `dangerously_bypass_approvals_and_sandbox` | Boolean | Disabled |
| `features.default_mode_request_user_input` | Boolean in `[runtime_options.features]` | Native default (off in verified Codex 0.160.0) |

The selected model/provider must support the chosen effort and native policy.
Unknown keys, wrong types, unavailable models and refused settings fail; they are
not silently ignored. Native effective settings are checked after create/resume.
`max` is passed unchanged to Codex; it is not an alias for `xhigh` or `ultra`.
Check the selected native model catalog before choosing it. `ultra` can enable
native automatic delegation and is not selected by requesting `max`.

Full access is unsandboxed execution with the controller user's filesystem and
network privileges, not root access. It does not imply automatic approval:
`on-request` still routes native permission review links to the owner's private DM.
Restricted sandbox choices remain available. Native restricted-policy defects
are not repaired by changing one utility or weakening project privacy checks.

### Native bypass option

This uses Codex's native flag name, expressed as a TOML key:
```toml
[runtime_options]
model = "YOUR_SUPPORTED_MODEL"
model_reasoning_effort = "high"
dangerously_bypass_approvals_and_sandbox = true
```

It selects `sandbox_mode = "danger-full-access"` and
`approval_policy = "never"`, equivalent to
`--dangerously-bypass-approvals-and-sandbox`. The app-server CLI does not accept
that TUI flag; the adapter supplies the corresponding native thread settings.
Conflicting explicit sandbox/approval values fail. Compatible explicit values
are allowed. `false` leaves ordinary values/defaults in effect. There is no
`yolo` configuration alias. Use only when this unsandboxed, no-confirmation
execution is intended.

### Structured questions

To offer native human questions in Codex Default mode:
```toml
[runtime_options.features]
default_mode_request_user_input = true
```

This is an explicit native under-development feature, not global configuration
or terminal prose interception. Enabling it requires the selected native binary
to expose `default_mode_request_user_input` in `codex features list`. Startup
checks the capability before spawning an engine, in addition to the baseline
stock Codex 0.158.0+ requirement. Missing capabilities fail explicitly, never
silently disable the option. All native questions
in one request retain their identities, option/free/secret-answer flags and
deadline. The owner receives Crossfire links and explicitly submits the complete
answer; clicking a link never grants permission. Native Default-mode questions
may be nonblocking and expire. Linux/inert-provider proofs do not certify a
particular paid model or macOS. Unsupported interactive stdin is not emulated.
- [Human decisions and disclosure boundaries](https://github.com/control-flow-project/crossfire/blob/main/services/crossfire/docs/runtime.md)

### Apply changes

Stop and start the affected agent:
```sh
fleet agent stop research analyst-east
fleet agent start research analyst-east
```

Or stop/start the fleet. Current definition model, reasoning, sandbox and approval
settings apply to the original saved history/histories; identity/cursors remain intact.
Editing a running definition does not hot-reconfigure an engine.
Do not append native permission flags to a remote TUI resume command.

## rooms.toml

Rooms must already exist in Matrix. This file is a reviewed management plan, not
an implicit startup action or room creator:
```toml
fleet = "research"

[[agents]]
instance = "analyst-east"

[[agents.grants]]
room = "!EXISTING_STABLE_ROOM_ID:YOUR_SERVER"
access = "reply"
muted = false
```

Open the fleet Room plan tab, submit the plan, review its diff and explicitly
confirm. Native authority, owner ceiling and revisions are checked at application.
Read-only, reply and custom-power grants remain separate from wake selection.
Custom access uses `access = "custom"` with an integer `level`. Invitation
defaults come from owner-approved `agent.toml` coordination settings; management
can adjust a room's applied permission set. Neither belongs in `rooms.toml`.
Empty grants remove discretionary access for included instances; the built-in
owner DM is preserved. Omitted instances are untouched. Owner DM access and
delegation cannot be edited through this plan.

Invitation permission allows an agent to invite registered agents across owners
and remove admissions it introduced, subject to Matrix authority. Membership
alone does not wake all agents. Assign the smallest room set and wake authority
needed; remove specialists when their work ends.
- [Permissions and wake rules](https://github.com/control-flow-project/crossfire/blob/main/services/crossfire/docs/management.md)

# Fleet configuration

A fleet directory contains a roster, role definitions and private instance state.
The loader rejects unknown fields, invalid names, unsafe paths and contradictory
settings. Definitions are trackable; `.fleet/` and workareas are private state.

## Directory

```text
research/
  runtime.toml
  rooms.toml
  .fleet/
  agents/
    analyst/
      agent.toml
      AGENTS.md
      workarea/
        analyst-east/
          .codex/ or .pi/
          .crossfire/
        analyst-west/
          .codex/ or .pi/
          .crossfire/
```

Workareas are distinct non-overlapping relative descendants of
`agents/<definition>/workarea/`. They own identity, cursors, histories and
receipts. Optional `workspace` changes native cwd, not state ownership.

## Roster

```toml
fleet = "research"

[coordination]
adapter = "crossfire"
server = "https://example.test"
owner = "@member:example.test"

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

[instances.runtime_options]
model_reasoning_effort = "high"

[instances.listener_options]
history_mode = "per-room"
```

Fleet/definition/instance keys and registered names begin with a lowercase letter,
then lowercase letters, digits or hyphens, maximum forty characters.
Instance keys remain local identity selectors. Registered names are globally
unique on the Crossfire instance. A collision rejects the entire introduction;
there is no automatic suffix or name-based takeover.

A definition supplies defaults. Each provided top-level native instance value
replaces its default; nested tables replace whole values, not recursive fields.
The adapter validates the same result during inspection, start/resume, recovery
and reset. Changes apply at a stopped-to-running transition.

## Role

```toml
name = "Research analyst"
runtime = "codex"

[runtime_options]
model = "EXACT_AVAILABLE_MODEL_ID"
model_reasoning_effort = "high"
sandbox_mode = "danger-full-access"
approval_policy = "on-request"

[coordination_options]
wake_mode = "selected"
permissions = ["room.agent.invite"]

[[coordination_options.wake_senders]]
matrix_user_id = "@member:example.test"
include_agents = true
```

`name` is the role label, not an account override. `AGENTS.md` supplies native
role instructions; nested project instructions retain their native semantics.
Several instances reuse definitions, not mutable histories.

## Native options

Codex owns `model`, `model_reasoning_effort`, `sandbox_mode`,
`approval_policy`, `dangerously_bypass_approvals_and_sandbox` and supported
native feature options. Its admitted effort strings are none, minimal, low,
medium, high, xhigh, max and ultra, subject to actual selected-model support.

Omitted sandbox/approval selects danger-full-access/on-request.
An explicit true bypass selects danger-full-access/never; conflicting explicit
settings fail. Max is not an alias for xhigh or ultra.
Default-mode structured questions require the native
`features.default_mode_request_user_input` capability.
Unknown or unavailable options fail rather than silently clamp.

Pi owns provider/model/thinking_level and rejects Codex permission fields.
Its exact available model and level are checked natively.

- [Pi configuration](pi.md)

## Coordination defaults

Modes are `selected`, `humans` and `everyone`.
Selected entries combine with OR. A human always includes themselves; true
`include_agents` also includes their currently active agents.
An individual agent entry requires false. Empty selected wakes nobody.
Everyone requires an empty list.

The only role admission capability is `room.agent.invite`, absent by default.
It grants no room membership, enrollment approval or process control.
It is materialized through ordinary generation-bound room permissions.

Owner approval reviews the exact roster and defaults. Existing approved resume
uses saved authority without overwriting management-edited wake/room rules.
Use explicit stopped-fleet enrollment to propose new/renamed identities or changed
coordination defaults. Controller proof cannot approve its own policy.

## History and size

Shared is the default. Per-room retains an exact history for each immutable room
and a private control context. Changing mode does not copy/merge/replay histories.
Neither mode isolates tools, files or credentials.

Crossfire instance policy, not the roster, owns the inline byte limit and idle
sleep timeout. Large complete input uses private files. Native output/patches
do not inherit that incoming-message budget.

## Room plan

```toml
fleet = "research"

[[agents]]
instance = "analyst-east"

[[agents.grants]]
room = "!EXACT_ROOM_ID:example.test"
access = "reply"
muted = false
```

The selected immutable fleet plus instance key resolves the agent.
Access is read, reply or custom; only custom includes integer `level`.
A plan replaces discretionary grants for listed instances only. Omitted grants
for those instances are removals; `grants = []` removes all discretionary access.
It never creates rooms, enrolls identities or removes a protected owner DM.
Preview/apply checks exact input, revisions and current native authority.

## Secrets and activation

Do not put tokens, passwords, endpoints, session IDs or shell commands in tracked
roster/role files. Private directories use 0700 and state files 0600.
The adapter refreshes current host provider login at actual native activation.
It does not copy the setup assistant's history, trust settings or bypass policy.

A missing/corrupt established history fails. Only explicit fresh-history reset
authorizes replacement. Inspect effective settings and each instance outcome
after an update.

- [Session controls](sessions.md)
- [Crossfire history](https://github.com/control-flow-project/crossfire/blob/main/services/crossfire/docs/history.md)

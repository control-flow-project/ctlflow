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

A definition owns settings/instructions. Instances share a definition, not
mutable sessions or work areas. Different settings require different definitions.
Private `.fleet`, `.codex` and `.crossfire` state holds registry bindings,
provider credentials, session history and delivery positions. Never commit it.

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

[[instances]]
key = "analyst-west"
name = "analyst-west"
definition = "analyst"
workarea = "agents/analyst/workarea/analyst-west"
```

Keys/names start with a lowercase letter, contain lowercase letters, digits or
hyphens, and are at most 40 characters. Instance names, keys and work areas must
be distinct. Work areas are non-overlapping relative children of
`agents/<definition>/workarea/`; symlinked or unsafe private paths fail.

The coordination block supplies server/owner once. It contains no approval room,
runtime transport, session UUID or secret. The private owner DM is automatic.

## agent.toml

```toml
name = "Research analyst"
runtime = "codex"

[runtime_options]
model = "YOUR_SUPPORTED_MODEL"
model_reasoning_effort = "high"
sandbox_mode = "danger-full-access"
approval_policy = "on-request"
```

The roster work area supplies native cwd. The companion `AGENTS.md` supplies
role instructions. The functional Codex adapter alone validates/translates native
options; fleetd does not interpret Codex-specific settings.

| Field | Accepted values | When omitted |
| --- | --- | --- |
| `model` | Nonempty native model ID, up to 200 characters | Native provider/config selection |
| `model_reasoning_effort` | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `ultra` | Native config selection |
| `sandbox_mode` | `read-only`, `workspace-write`, `danger-full-access` | `danger-full-access` |
| `approval_policy` | `untrusted`, `on-failure`, `on-request`, `never` | `on-request` |
| `dangerously_bypass_approvals_and_sandbox` | Boolean | Disabled |

The selected model/provider must support the chosen effort and native policy.
Unknown keys, wrong types, unavailable models and refused settings fail; they are
not silently ignored. Native effective settings are checked after create/resume.

Full access is unsandboxed execution with the controller user's filesystem and
network privileges, not root access. It does not imply automatic approval:
`on-request` still routes native permission requests to the owner's private DM.
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

### Apply changes

Stop and start the affected agent:
```sh
fleet agent stop research analyst-east
fleet agent start research analyst-east
```

Or stop/start the fleet. Current definition model, reasoning, sandbox and approval
settings apply to the same saved session UUID; identity/cursors remain intact.
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
delegation is assigned separately in management, not in `rooms.toml`.
Empty grants remove discretionary access for included instances; the built-in
owner DM is preserved. Omitted instances are untouched. Owner DM access and
delegation cannot be edited through this plan.

Invitation permission allows an agent to invite registered agents across owners
and remove admissions it introduced, subject to Matrix authority. Membership
alone does not wake all agents. Assign the smallest room set and wake authority
needed; remove specialists when their work ends.
- [Permissions and wake rules](../../crossfire/docs/management.md)

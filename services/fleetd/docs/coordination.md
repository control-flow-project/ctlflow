# Coordination defaults

Role `coordination_options` is separate from native `runtime_options`.
Instances inherit the role's complete policy; native overrides cannot change it.

```toml
[coordination_options]
wake_mode = "selected"
permissions = ["room.agent.invite"]

[[coordination_options.wake_senders]]
backend_user_id = "@owner:example.test"
include_agents = true

[[coordination_options.wake_senders]]
backend_user_id = "@another-person:example.test"
include_agents = false
```

## Wake modes

| Mode | Eligible sources |
| --- | --- |
| selected | Explicit entries only |
| humans | Active registered humans plus explicit entries |
| everyone | Active humans and agents; no explicit entries |

A human entry includes that person; true also includes their currently owned
active agents, including later additions and agents outside this fleet.
Individual agent entries require false. Entries combine with OR.
Empty selected wakes nobody; there is no implicit owner or self allowance.
Inactive people/agents or agents with inactive owners cannot wake a listener.

An explicit block requires mode, permissions and senders.
At most 2000 distinct entries are allowed. Unknown capabilities, duplicate IDs,
old presets and flat sender-ID forms fail validation.
Omitting the block requests the actual owner, person only, and no invitation
permission.

## Approval

Enrollment reviews exact names, controller, complete policy and current ownership.
Only the named human owner can approve. Private controller/agent proof cannot
approve policy. Room membership remains a separate native-authorized decision.

New ordinary room generations materialize approved invitation defaults through
the canonical room-permission owner. Owner/management DMs never delegate.
Current human edits remain authoritative during ordinary resume.
Use explicit stopped-fleet enrollment when proposing changed defaults.

## Invitations

`room.agent.invite` allows an authorized agent to add existing registered agents,
including another owner's, within its current native room authority.
It does not create identities, start processes, approve enrollment or add
permission beyond the native ceiling.

Removal is limited to additions attributed to the invoking agent.
A duplicate add does not transfer provenance; remove/re-add creates a new
generation. Targets retain their own independently approved defaults.
Invitation authority does not imply wake authority.

## Delivery

The listener verifies current account/owner, room membership, unmuted access,
wake source and exact controller generation before native input.
A native user mention steers only if that source is accepted.
Quoted names, old context and automated notices never become controls.

Unknown or blocked traffic does not call the model.
Non-waking messages remain pending context for a later authorized trigger.
Housekeeping, heartbeats, enrollment and policy checks are ordinary code.

- [Definitions](https://github.com/control-flow-project/ctlflow/blob/main/services/fleet/docs/configuration.md)
- [crossfire runtime behavior](https://github.com/control-flow-project/ctlflow/blob/main/services/crossfire/docs/runtime.md)

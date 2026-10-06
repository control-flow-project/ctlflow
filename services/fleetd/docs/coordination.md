# Fleet coordination settings

## Define a role

Keep Crossfire settings separate from the runtime adapter's native options in
`agents/<role>/agent.toml`. Every instance referencing the role inherits the same
complete coordination policy:

```toml
name = "Analyst"
runtime = "codex"

[runtime_options]
model = "YOUR_SUPPORTED_MODEL"
model_reasoning_effort = "high"

[coordination_options]
wake_mode = "owner-agents"
permissions = ["room.agent.invite"]
```

| Field | Values | Default |
| --- | --- | --- |
| `wake_mode` | `nobody`, `owner`, `owner-agents`, `humans`, `everyone`, `selected` | `owner` when the whole block is absent |
| `permissions` | `[]` or `["room.agent.invite"]` | `[]` when the whole block is absent |
| `sender_matrix_ids` | Unique registered Matrix IDs, only with `selected`, at most 2000 | `[]` |

An explicit block requires both `wake_mode` and `permissions`. Unknown fields,
capabilities, duplicate IDs or nonselected sender lists fail validation. Different
role policies require different definitions; there are no instance overrides.
Every Crossfire agent belongs to a fleet; this role policy applies equally to
one-agent project setup and larger fleets.

`owner-agents` includes the verified owner and that owner's active agents,
including agents outside this fleet. `humans` additionally includes other humans.
`everyone` includes humans and their active agents. Self messages never wake the
receiver. Suspended/revoked people and agents with inactive owners cannot wake it.

To allow a specific cross-owner worker and human:

```toml
[coordination_options]
wake_mode = "selected"
sender_matrix_ids = ["@human:YOUR_SERVER", "@agent-IMMUTABLE_UUID:YOUR_SERVER"]
permissions = ["room.agent.invite"]
```

Use actual registered Matrix IDs from the directory or agent details, not display
names or role labels. Empty selection wakes nobody; the owner is not implicitly
included. The server resolves IDs to immutable principals and rechecks their
authority at approval. Enrollment cannot select an uncreated identity by name.

## Approval and changes

1. `fleet start <fleet>` submits names, controller identity and each exact policy.
2. The owner opens the displayed approval URL, verifies the code and reviews the
   complete roster, wake authors and invitation capability.
3. Approval applies wake rules and invitation defaults atomically. No additional
   management configuration or model call is required.

An existing identity or controller credential cannot authorize new capabilities.
Changed policies require owner review on stop/start, including existing agents.
Stale agent revisions, changed senders or expired/rejected requests cannot grant
authority. An explicit subsequent start can request a fresh review; the daemon
does not resubmit a rejected request while waiting.

Unchanged reconnects preserve identities, histories and room-specific permission
edits. Management remains available for deliberate adjustments. A changed policy
approval replaces defaults on all current ordinary grants and future admissions;
the review explicitly describes this effect. Editing a running file has no effect
until stop/start. Retiring an instance or archiving a fleet requires confirmed
native stop and settled decisions. The identity remains fleet-bound and preserved
for audit; no independent listener or detach path is created.

## Room admission and removal

Configuration creates or joins no room. `rooms.toml` remains an optional explicit
existing-room access plan, not an automatic startup action. Humans create rooms
in Element and invite only the workers they need.

On a new authorized ordinary-room admission, Crossfire applies that receiver's
own approved invitation defaults to the new membership generation. This also
works for native Element invitations and cross-owner agent invitations. Existing
manual room edits persist within that generation; readmission applies defaults
again. Authorization reads the resulting canonical room permission rows, not a
global permission union or a controller-side permission system.

An agent with `room.agent.invite` and applicable native Matrix authority may invite
another registered agent across owners. It may remove only additions attributed
to itself in the current generation. Owners manage their own agents; administrators
have their separately verified authority. Removing an owner-added worker or
another agent's addition is denied. Native room ceilings and current delegation
still apply. The inviter never transfers its own permissions to the target.

Owner and management DMs exclude third-agent delegation. These private channels
are protected even while native admission is pending. Fleet configuration does
not grant native power, ownership, enrollment approval or permission to edit
another agent's settings. Wake eligibility, room membership and invitation
capability remain separate.

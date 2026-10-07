# Fleet commands

## Controller selection

```sh
fleet setup --descriptor PERSONALIZED_SETUP_JSON_URL
fleet setup --descriptor PERSONALIZED_SETUP_JSON_URL --config /absolute/private/research/runtime.toml
fleet daemon start --name laptop --root /absolute/private/controller
fleet daemon status
fleet daemon stop
fleet daemon restart
fleet --root /absolute/private/controller list
fleet remote add office --ssh operator@office-host --root /absolute/private/controller
fleet --remote office list
```

The local root/remote connection is private CLI state. Labels are not credentials.
Remote commands use SSH and the same private controller API.

## Fleet and agent lifecycle

```sh
fleet add /absolute/private/research
fleet list
fleet show research
fleet test research
fleet start research
fleet start research --fresh-history
fleet agent list research
fleet agent add research analyst-west --definition analyst
fleet agent start research analyst-west
fleet agent start research analyst-west --fresh-history
fleet agent attach research analyst-west
fleet agent contexts research analyst-west
fleet agent attach research analyst-west --context '!ORIGINAL_ROOM_ID:YOUR_SERVER'
fleet agent stop research analyst-west
fleet agent remove research analyst-west
fleet stop research
fleet remove research
```

Add registers an explicit directory or instance. New identities need owner
approval. Start automatically resumes the full saved native histories. Missing
or broken established history is an error, not permission to create a new one.
An already approved roster resumes using its saved controller authority, without
enrollment or overwriting owner-edited wake rules. Use explicit `fleet enroll`
while stopped to propose changed coordination defaults for owner review.
Local start starts or reuses the configured controller. Status/list/show/test,
contexts, attachment and registry edits never start it. Stop ends addressed
listeners and owned Codex processes. Instance removal retires its fleet registration;
whole-fleet removal archives the approved registration. Actual stopped native
evidence and settled decisions are required. Files, history, identity and audit
records are preserved; removal never creates an independent agent. Closing the
CLI does not cancel accepted controller work.

Operation results distinguish pending approval, success and per-instance failure.
Idempotency keys and expected revisions prevent conflicting replays.
Fleet-wide and per-agent start and stop commands accept `--operation-id UUID` for an
exact retry after uncertain submission; the command prints its ID before submission.
Name collisions, missing credentials and invalid native settings stay errors.

Contexts lists exact saved histories even when stopped or sleeping, without
starting native processes. `fleet show` reports native phase, desired activation,
last activity and history availability. Explicit `fleet agent start` wakes a
sleeping native engine without input or binding replacement. Attach
without a context selects the shared history, or private control history in
per-room mode. `--context` chooses an existing listed context; it never creates
a new room conversation or reads credentials into public management output.

`start --fresh-history` explicitly selects the controller's reset operation, for
one agent or the whole fleet. It stops selected owned processes, verifies complete
available authorized history and nonsecret configuration exports, then starts fresh
native contexts with the same identities and current definition parameters.
It is not normal resumption. Use `--operation-id UUID` with the identical command
to retry an uncertain request. The independent coding session doing setup is
never controlled here.
- [Session controls, full-history resume and fresh-history confirmation](sessions.md)
- [Export, boundaries and reset retention](https://github.com/control-flow-project/crossfire/blob/main/services/crossfire/docs/history.md)

## Delivery control and broadcast

```sh
fleet deactivate research
fleet activate research
fleet message research --text "Review the updated assignment"
fleet message research --message-id YOUR_UUID --text "Review the updated assignment"
```

Deactivate pauses fleet-bound delivery but retains controller connections,
engines and sessions. Activate resumes those bindings and unread positions.
Crossfire UI provides equivalent revision-checked control. Connection loss pauses
delivery; reconnect applies current server intent. Every receiver is fleet-bound.

Message queues explicit input per enrolled agent through the controller. It
does not join rooms, alter wake rules or revive explicitly stopped agents.
A sleeping active binding resumes its exact native history for eligible input.
The CLI prints
a message UUID before submission. Retry uncertain submission with the same UUID
and identical text; conflicting reuse fails. The fleet must be enabled and
controller connected; messages expire after ten minutes.

Management exposes delivered/pending/skipped/failed/expired outcomes. A native
receipt proves publication, not completed model work.

## Model-free readiness

`fleet test research` reads each desired receiver through the actual shared
listener control endpoint. It checks exact native identity, authentication,
membership, idle availability and enabled delivery. It creates no model turn,
conversation or unread-position update. Busy, paused, unavailable and stopped
bindings fail explicitly; a sleeping receiver can pass without waking Codex.

## Explicit software update

After human consent and installing the exact new public release, use that newly
installed executable:

```sh
fleet update research
fleet agent update research analyst-east
fleet daemon restart
```

Update sends the installed controller's declared immutable artifact directory to
fleetd. The lifecycle operation stops selected receivers/native processes,
installs pinned agent tools/skills and resumes only previously desired agents
with their exact histories. Stopped agents stay stopped. It never re-enrolls or
uses a standalone connection command. Review every per-instance outcome.
Restart replaces the controller binary after update and retains desired intent.

For an SSH controller, the source directory must exist on that computer:

```sh
fleet --remote office update research --release-directory /absolute/private/installed/node_modules/@ctlflow/fleetd/dist/assets
```

The controller validates that exact directory and release before replacement.
Alternatively invoke the newly installed CLI directly over SSH. `daemon restart`
runs locally on the controller computer, not through the remote CLI tunnel.

# Fleet commands

## Controller selection

```sh
fleet daemon start --name laptop --root /absolute/private/controller
fleet daemon status
fleet daemon stop
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
Stop ends addressed listeners and owned Codex processes. Remove requires stopped
execution and preserves files, native history and ordinary Crossfire identity;
it removes grouping, not the account. Closing the CLI does not cancel daemon work.

Operation results distinguish pending approval, success and per-instance failure.
Idempotency keys and expected revisions prevent conflicting replays.
Fleet and individual start and stop commands accept `--operation-id UUID` for an
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
to retry an uncertain request. A direct attached session is never controlled here.
- [Session controls, full-history resume and fresh-history confirmation](sessions.md)
- [Export, boundaries and reset retention](../../crossfire/docs/history.md)

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
delivery; reconnect applies current server intent. Direct listeners are independent.

Message queues explicit input per enrolled agent through the controller. It
does not join rooms, alter wake rules or revive explicitly stopped agents.
A sleeping active binding resumes its exact native history for eligible input.
The CLI prints
a message UUID before submission. Retry uncertain submission with the same UUID
and identical text; conflicting reuse fails. The fleet must be enabled and
controller connected; messages expire after ten minutes.

Management exposes delivered/pending/skipped/failed/expired outcomes. A native
receipt proves publication, not completed model work.

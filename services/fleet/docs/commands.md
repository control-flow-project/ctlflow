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
fleet agent list research
fleet agent add research analyst-west --definition analyst
fleet agent start research analyst-west
fleet agent attach research analyst-west
fleet agent contexts research analyst-west
fleet agent attach research analyst-west --context '!ORIGINAL_ROOM_ID:YOUR_SERVER'
fleet agent stop research analyst-west
fleet agent remove research analyst-west
fleet stop research
fleet remove research
```

Add registers an explicit directory or instance. New identities need owner
approval. Start automatically resumes saved native sessions.
Stop ends addressed listeners and owned Codex processes. Remove requires stopped
execution and preserves files, native history and ordinary Crossfire identity;
it removes grouping, not the account. Closing the CLI does not cancel daemon work.

Operation results distinguish pending approval, success and per-instance failure.
Idempotency keys and expected revisions prevent conflicting replays.
Name collisions, missing credentials and invalid native settings stay errors.

Contexts lists exact retained running histories and their native state. Attach
without a context selects the shared history, or private control history in
per-room mode. `--context` chooses an existing listed context; it never creates
a new room conversation or reads credentials into public management output.

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
does not join rooms, alter wake rules or start unavailable agents. The CLI prints
a message UUID before submission. Retry uncertain submission with the same UUID
and identical text; conflicting reuse fails. The fleet must be enabled and
controller connected; messages expire after ten minutes.

Management exposes delivered/pending/skipped/failed/expired outcomes. A native
receipt proves publication, not completed model work.

# fleet commands

## Controller and transport

```sh
fleet setup --descriptor PERSONALIZED_SETUP_JSON_URL
fleet daemon start --name workstation --root /absolute/private/controller
fleet daemon status --root /absolute/private/controller
fleet daemon stop --root /absolute/private/controller
fleet daemon restart --root /absolute/private/controller
fleet --root /absolute/private/controller list
fleet remote add office --ssh operator@office-host --root /absolute/private/controller
fleet --remote office list
```

Use a private explicit root or the saved local profile.
Remote paths belong to the controller host. Status/inspection does not start
a controller. Local start/setup may start or reuse the configured controller.
Labels and profile names do not authenticate a connection.

## Registry and lifecycle

Use `fleet diagnose [FLEET]` or `fleet agent diagnose FLEET INSTANCE` for bounded,
read-only findings, including when the daemon is unreachable. These commands do
not start a controller or native session.

- [Diagnostic report and limits](diagnostics.md)

```sh
fleet add /absolute/private/research
fleet list
fleet show research
fleet test research
fleet enroll research
fleet start research
fleet stop research
fleet remove research
fleet agent list research
fleet agent add research analyst-west --definition analyst
fleet agent start research analyst-west
fleet agent stop research analyst-west
fleet agent remove research analyst-west
```

Add registers explicit configuration; it does not discover directories.
Enroll proposes the stopped roster and policies for owner review without enabling
execution. Start resumes saved histories. Stop removes desired activation before
closing listeners/native processes. Remove retires/archive coordination authority
after exact stop evidence; files and histories remain.

Start/stop at either scope accept `--operation-id UUID` for an identical retry
after uncertain submission. Conflicting reuse fails. Accepted operation does not
mean native completion; inspect its per-instance outcome.

## Native histories and reset

```sh
fleet agent contexts research analyst-west
fleet agent attach research analyst-west
fleet agent attach research analyst-west --context 'room/!EXACT_ROOM_ID:example.test'
fleet start research --fresh-history
fleet agent start research analyst-west --fresh-history
```

Contexts is read-only. Attach prints the exact running native terminal command;
it does not start/fork a conversation or launch another listener.
Use the exact context key reported by `contexts`: private histories use `shared`
or `control`; per-room histories use `room/` followed by the opaque room ID.
Pi does not support live TUI attachment.

Fresh history explicitly calls controller reset. Normal start does not.
Reset preserves identity, permissions, chat data and archived native histories.

## Delivery and direct input

```sh
fleet deactivate research
fleet activate research
fleet message research --text 'Review the changed assignment'
fleet message research --message-id YOUR_UUID --text 'Review the changed assignment'
```

Pause/activate changes delivery, not native identity/history.
A direct fleet message does not join rooms, grant wake authority or start
explicitly stopped agents. A sleeping active binding can resume.
Retry uncertainty with the same UUID and text. Messages expire after ten minutes;
native receipts are not model-task completion.

## Software update

After installing an approved exact release, use its new executable:

```sh
fleet update research
fleet agent update research analyst-west
fleet daemon restart --root /absolute/private/controller
```

Remote update requires an already installed absolute release directory:

```sh
fleet --remote office update research \
  --release-directory /absolute/private/install/node_modules/@ctlflow/fleetd/dist/assets
```

Only previously desired-active targets resume; deliberately stopped targets remain
stopped. No HTTP release-directory fallback exists.

- [Session semantics](sessions.md)
- [Update procedure](operations.md)

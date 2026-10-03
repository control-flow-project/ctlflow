# Remote controllers and agent terminals

## SSH management

Start fleetd as the normal user on the controller computer. Then:
```sh
fleet remote add office --ssh operator@office-host --root /absolute/private/controller
fleet --remote office list
fleet --remote office add /absolute/private/research
fleet --remote office start research
fleet --remote office agent attach research analyst-east
fleet --remote office agent contexts research analyst-east
fleet --remote office agent attach research analyst-east --context '!ORIGINAL_ROOM_ID:YOUR_SERVER'
fleet --remote office stop research
```

Remote directories refer to that computer. Existing SSH authentication, host-key
verification and Unix-socket forwarding authorize the connection. The CLI changes
no SSH configuration, keys, permissions or public listening ports. Closing its
temporary tunnel does not stop the controller.

## Native TUI pointer

`fleet agent attach research analyst-east` prints a ready-to-run native command
for the exact running saved session. Copy and run it manually. The command starts
a terminal client, not another engine/session/listener. Closing the TUI leaves
fleet execution running.

For a per-room instance, first list contexts. Attach defaults to its separate
private control history; pass the exact listed room ID to inspect that room's
conversation. Multiple histories share one engine/identity/workarea. A pointer
does not create, seed or replay a conversation. Direct attached agents have only
their existing shared history.

The runtime adapter owns session selection and native arguments. The private
token is read from a run-local file into the client's environment, never printed
in command text/API/logs. The engine's native home, executable and search path
are retained, including software installed through NVM.

Remote attachment prints an SSH-wrapped command that executes on the controller.
No additional public port or forwarding service is needed. Request a fresh pointer
after engine restart; old run-local credentials are removed.

Model and permissions belong in the definition, not remote resume overrides.
Stop/start applies configuration to the saved session.
- [Runtime configuration](configuration.md)

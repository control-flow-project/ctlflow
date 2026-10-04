# Fleet sessions

## Management

Open a fleet and select **Sessions**. An individual fleet-managed agent also has a
**Sessions** tab. The fleet owner and administrators can request:

| Action | Native execution | History and delivery |
| --- | --- | --- |
| Resume session(s) | Start stopped agents; retain already running agents. | Resume full saved native histories, identities and current configured parameters. Delivery follows the fleet's existing setting. |
| Stop session(s) | Close the selected listeners and owned engines. | Retain native histories, accounts, permissions and unread positions. The controller remains connected. |
| Start with fresh history | Stop selected agents, prepare private exports and restart with fresh model contexts. | Archive old bindings; retain identity, credentials, permissions, Matrix messages and configured parameters. Confirmation is required. |

Fleet scope means all enrolled agents in that fleet; agent scope means only the
selected agent. Fresh-history confirmation names the scope and explains that model
context is being replaced. Cancelling confirmation submits nothing. Stopping also
confirms that running operating-system commands are not frozen for later continuation.

The paginated operations table shows pending, running, succeeded or failed results
reported by the controller. Acceptance is not completion. A failed fleet operation
may contain successful peers; inspect the per-agent errors before retrying. An
offline controller cannot accept a session operation through management.

**Delivery** is separate: pausing delivery leaves native engines running and retains
their listeners' controller connection. Resuming sessions does not silently enable
a fleet whose delivery was paused. Each running agent has one listener, and the
fleet has a separate controller connection.

## CLI

```sh
fleet stop research
fleet start research
fleet agent stop research analyst-west
fleet agent start research analyst-west
```

Start defaults to full saved native history. No resume flag or transcript replay is
needed. The runtime retains its full conversation context even though controller
RPC responses omit old turn payloads. Missing or broken established bindings cause
a visible failure; they never silently fall back to new history.

Only an explicit flag selects fresh history:

```sh
fleet start research --fresh-history
fleet agent start research analyst-west --fresh-history
fleet agent start research analyst-west --fresh-history --operation-id YOUR_UUID
```

The flag is the CLI's explicit destructive intent. The command prints an operation
ID; retry uncertain submission with that same ID and identical arguments, not a
new ID. Fleet and individual start and stop commands all accept `--operation-id UUID`.
The controller persists outcomes and pins unacknowledged remote operations
so reconnects cannot repeat a completed reset. If the controller dies during an
operation, it reports that interrupted operation as failed rather than guessing
that it completed or silently performing another reset.

## Boundaries

First enrollment authorizes initialization of an agent's primary native history.
Successful binding consumes that authorization. Explicit fresh history authorizes
another initialization only after the old context is safely retired. In per-room
mode, a new room obtains its own history when first used; changing history mode is
an explicit configuration change, not an ordinary restart fallback.

Direct agents are not fleet-owned processes; their owners control native sessions
in the coding application. Neither management nor this CLI resets them. Native
history is not a guarantee that an unfinished shell process survives a stop.
This feature does not delete workarea files, Matrix chats or old native archives.

- [History exports, unread positions and reset preparation](../../crossfire/docs/history.md)
- [Configured runtime parameters and history modes](configuration.md)
- [Controller recovery and private API](../../fleetd/docs/operations.md)

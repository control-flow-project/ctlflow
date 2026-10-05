# Fleet sessions

## Management

Open a fleet's **Agents** tab: the agents table comes first, followed by the
fleet-wide **Native sessions** controls. For one agent, open its **Session** tab.
The fleet owner and administrators can request:

| Action | Native execution | History and delivery |
| --- | --- | --- |
| Resume session(s) | Start stopped agents or wake sleeping native engines; retain active bindings. | Resume full saved native histories, identities and current configured parameters. Delivery follows the fleet's existing setting. |
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

**Delivery** is separate: pausing delivery retains active bindings and any live
native engines. Resuming sessions does not silently enable a fleet whose delivery
was paused. fleetd itself hosts the listeners: one binding per active agent, not
one listener process per agent. Each fleet has its scoped controller connection.

## Automatic sleep

Crossfire's Policy page sets fleet idle sleep; the default is 30 minutes and zero
disables it. An idle native engine can be closed while its receiver remains
online. Sleeping is not stopped: eligible chat, scheduled or broadcast input
wakes it and resumes the exact saved history. Busy histories, pending decisions,
input or receipts and unknown activity prevent sleep.

`fleet show` exposes native phase, desired binding intent, last native activity,
listener activity and history availability separately. `fleet agent contexts`
reads saved context IDs while sleeping or stopped without waking a process.
Attachment requires a live native endpoint; GET never launches one. Use Resume
sessions or `fleet agent start` to wake a sleeping native engine for a terminal
without changing its binding or sending a model prompt.

Orderly daemon shutdown preserves desired activation. Starting the same daemon
root after a reboot restores active bindings with retained histories; explicitly
stopped agents remain stopped. No automatic operating-system boot service is
installed. Preserve the controller root as well as fleet workareas and credentials.

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
new ID. Fleet-wide and per-agent start and stop commands accept `--operation-id UUID`.
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

Every Crossfire agent is fleet-owned. The coding session performing setup remains
independent and is never adopted, stopped or reset. Native history is not a
guarantee that an unfinished shell process survives a stop.
This feature does not delete workarea files, Matrix chats or old native archives.

Local stop records actual native close through the same current controller/run
receipt used by management operations. If acknowledgment fails, native processes
remain stopped and the error stays visible; automatic recovery is not blocked by
that network failure. Retry stop with a new operation ID after checking the
reported outcome. Pending proofs retry only while their exact controller
generation remains valid. After generation turnover, explicitly resume and stop
the binding to obtain current evidence. Retirement and fleet archive stay refused
until Crossfire confirms settled receipts and actual native stop.

- [History exports, unread positions and reset preparation](https://github.com/control-flow-project/crossfire/blob/main/services/crossfire/docs/history.md)
- [Configured runtime parameters and history modes](configuration.md)
- [Controller recovery and private API](https://github.com/control-flow-project/crossfire/blob/main/services/fleetd/docs/operations.md)

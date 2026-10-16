# Session controls

## Separate controls

| Control | Effect |
| --- | --- |
| Stop sessions | Saves enabled selection, removes desired activation, closes listeners/native engines |
| Resume sessions | Restores saved selection and exact histories |
| Pause delivery | Stops new input; retains controller/native sessions and unread state |
| Idle sleep | Stops idle native engines; listener remains ready for eligible input |
| Fresh history | Explicit controller reset after verified history/config export |
| Account suspension | Removes account authority; not a native process receipt |
| Fleet archive/agent retirement | Decommissions operational authority after settled stop evidence |

Fleet Stop remembers exactly which instances were enabled. Resume restores that
selection plus currently enabled instances, not every enrolled account.
Repeated Stop retains the original selection; an empty selection resumes nobody.
Per-agent Stop removes that instance from the saved selection.

## Default resume

UI and CLI ordinary start resumes full saved history with the same identity and
configured native parameters. Current provider authentication is recopied on
activation. Unread positions and pending receipts are retained.

When unfinished-work evidence exists, the adapter first settles older input.
It then inserts one receipt-backed restart instruction to reread AGENTS.md,
inspect prior effects and continue unfinished authorized work.
Idle/sleeping contexts receive no dummy task.

The native process does not resurrect an old operating-system command or active
turn. Uncertain earlier delivery is explicitly supplied as restart context, not
reported as a receipt from the previous process.

## Fresh history

Management requires explicit confirmation. CLI requires:

```sh
fleet start research --fresh-history
fleet agent start research analyst-east --fresh-history
```

Only fleetd performs reset. It stops selected execution, verifies available
authorized Matrix history and nonsecret configuration exports, archives old
bindings/checkpoints and starts fresh contexts with the same identity/settings.
Interrupted phases retain their operation identity. Failed exports cannot replace
a context. Chats, media, credentials and archived histories are not erased.

## Native activity and attachment

```sh
fleet show research
fleet agent contexts research analyst-east
fleet agent attach research analyst-east
```

Working, waiting, idle, sleeping, stopped and unknown are different states.
A heartbeat is not evidence of progress. Context listing is read-only.
Attach returns the exact running native command; it does not create another
engine or history. Pi live attachment is unsupported.

## Host/controller restart

Start the original controller root after reboot. Durable desired intent restores
enabled bindings; explicit stopped selections remain stopped.
No boot service is installed automatically.

A killed controller can leave a native writer alive. Its lock prevents competing
history ownership; resolve that exact process before resuming.
Retained data alone does not guarantee a provider/native service is available.

- [Controller operations](https://github.com/control-flow-project/crossfire/blob/main/services/fleetd/docs/operations.md)
- [History and uncertainty](https://github.com/control-flow-project/crossfire/blob/main/services/crossfire/docs/history.md)

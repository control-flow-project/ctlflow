# Controller operation

Start through fleet or the installed daemon:

```sh
fleet daemon start --name workstation --root /absolute/private/controller
fleetd --name workstation --root /absolute/private/controller
```

One private root owns one descriptor, explicit registry and Unix socket.
No public controller port or boot service is installed.
Closing the CLI/SSH connection does not cancel accepted operations.

## Ownership and API

Local and SSH clients use the same private HTTP resources:
status/setup/diagnostics, fleet registration, instance configuration, readiness,
delivery/messages, contexts/attachment and idempotent operations.
Unknown routes, methods, fields and duplicated queries are rejected.
Pagination is canonical positive decimal, page up to 100000, size up to 100.

Every request requires the persistent key in OS-native ctlflow/fleetd.json.
fleetd creates it on first start or completes valid keyless configuration.
fleet only reads it. SSH clients read the remote user's config, not the local key.

- [Authentication, upgrades and recovery](authentication.md)
- [Read-only diagnostic API](diagnostics.md)

Private SQLite exclusive locks own controller, fleet and receiver lifetimes.
They survive process suspension and release on exit. Do not delete lock inodes
or substitute an expiring PID lease. Directories must be private, owned and
canonical, with no symlink traversal.

UUID operation IDs and revisions reject conflicting reuse.
Per-instance outcomes distinguish approval, running, succeeded and failed.
Accepted work continues if its CLI disconnects.
Native processes are not created inside management database transactions.

## Sleep and work budgets

fleetd embeds the shared listener; no listener subprocess is required.
Per-agent credentials, cursors, permissions and receipts remain independent.
With every native history asleep, one fleetd application process remains.

Ordinary acquisition has sixteen permits, publication eight and native startup
four. Queues are bounded to 10000 and abortable.
Idle long polls do not occupy ordinary permits.
Accepted mentions preempt ordinary collection; unavailable immediate cold-start
capacity fails visibly without consuming unread input.

crossfire's idle policy defaults to 1800 seconds; zero disables sleep.
Every opened/initializing/retained history must be confirmed idle.
Pending input, decisions, receipts, cleanup or unknown activity prevents sleep.
Eligible room/DM/scheduled/fleet input resumes the exact retained history.
Metadata and attachment GETs never wake engines.

## Stop and restart

`desired-intent.json` records activation before startup and removes it before
explicit Stop. Normal controller shutdown preserves intent.
`resume-selections.json` retains the exact enabled selection saved by Fleet Stop.
Repeated Stop does not erase it; an empty selection resumes nobody.

After reboot, start the same controller root. Desired bindings restore with
bounded concurrency and exact sleeping histories. Provider login refreshes only
when eligible input activates native execution.
Manually stopped targets remain stopped. No filesystem discovery or native
conversation import is performed.

Restoration starts listeners, not model turns. All saved native histories remain
asleep until genuine eligible input arrives. An interrupted historical task or
pending owner decision cannot create a continuation prompt. Repeating Start does
not wake an already bound agent. First initialization/reset establishes a native
identity without inference and closes that initialization process before readiness.

## Failure and recovery

Transient listener failures close their exact generation before retry, with
one-to-sixty-second exponential backoff. A disconnected native engine is closed
and reported, and waits for genuine input to reopen its exact saved history.
Permanent configuration, authorization, filesystem or protocol conflicts require
action. Explicit Stop cancels binding recovery. Unconfirmed cleanup blocks
replacement. Pending message journals retain their own recovery/acknowledgment;
there is no separate historical-task restart prompt.

Controller lease loss closes local delivery immediately when detected; request
deadlines bound undetected loss. Old reporting failures cannot cancel a new run.
Native-close evidence is tied to its exact current authenticated tuple.

crossfire owns durable incident notification to the member's private crossfire DM.
Intentional Stop, ordinary idle and decision waits are not crashes.
A dead controller cannot report itself; server contact monitoring reports unknown
execution, not a proven process exit.

## Abrupt controller death

Every implementation guards the owned native engine group against controller
death, including SIGKILL. C# observes an exact parent process handle and Rust an exact parent pidfd. Each guard retains
the private native-group lock while stopping its owned group. A replacement
cannot bypass an existing writer lock. Tools that escape the owned group are
outside this protection.
No implementation uses process-name scanning, orphan adoption or copied history.

A full host restart removes old processes, but retained bindings still require
successful native resume and available provider/native services.
This is not a guarantee of arbitrary subprocess containment or exactly-once
external actions.

## Update and retention

Use explicit installed-release update through fleet, then restart the controller.
Only prior desired-active targets resume. Changed instructions use native
receipt-confirmed publication; software is not downloaded during recovery.

Optional private `config.json` contains `loggingRetentionDays`, default seven.
Completed operation/diagnostic history expires by age; pending/unacknowledged
work, credentials, histories and stop selections remain protected.

- [Storage ownership](storage.md)
- [Logging policy](https://github.com/control-flow-project/ctlflow/blob/main/services/crossfire/docs/logging.md)
- [Fleet session controls](https://github.com/control-flow-project/ctlflow/blob/main/services/fleet/docs/sessions.md)

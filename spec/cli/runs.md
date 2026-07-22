---
title: Runs
weight: 70
---

A Run is one invocation of a Job. It records its Job, concrete Context, requester or Trigger,
attempts, lifecycle, logs, and outputs.

```text
ctlflow run list --tenant TENANT [--job JOB] [--scope CONTEXT] [--watch]
ctlflow run get RUN --tenant TENANT
ctlflow run wait RUN --tenant TENANT
ctlflow run cancel RUN --tenant TENANT [--force] [--wait]
ctlflow run logs RUN --tenant TENANT [--follow]
ctlflow run artifacts RUN --tenant TENANT
ctlflow run artifact get RUN ARTIFACT --tenant TENANT
ctlflow run artifact download RUN ARTIFACT --tenant TENANT --output FILE
```

Runs progress through admitted, running, and one terminal outcome: succeeded, failed, or cancelled.
Retry attempts remain part of the same Run. Cancellation is an explicit domain transition and does
not imply that a committed external side effect was undone.

A Package may declare bounded Run input and output contracts. `job run` can accept a completed
artifact from the same Context or a local input file when that contract permits it. Local bytes
stream through a short-lived `egressd` transfer endpoint; they do not traverse the administrative
API.

Artifact reads return immutable metadata. `download` obtains short-lived transfer access from
`egressd` and verifies the stored digest while streaming through that endpoint. A terminal Run is immutable and is
removed only by configured retention, never by an ordinary user delete command.

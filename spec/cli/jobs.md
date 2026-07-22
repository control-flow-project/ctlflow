---
title: Jobs
weight: 60
---

A Job is reusable finite work with a stable virtual principal. An agent is a product label for a
Job with delegated identity, persistent state, and often Triggers; there is no `agent` command.

```text
ctlflow job list --tenant TENANT [--scope CONTEXT]
ctlflow job get JOB --tenant TENANT
ctlflow job create --tenant TENANT -f FILE
ctlflow job update JOB --tenant TENANT -f FILE
ctlflow job enable JOB --tenant TENANT
ctlflow job disable JOB --tenant TENANT
ctlflow job secret set JOB SLOT --tenant TENANT --from-file FILE [--wait]
ctlflow job secret delete JOB SLOT --tenant TENANT [--force] [--wait]
ctlflow job run JOB --tenant TENANT
  [--input-artifact ARTIFACT | --input-file FILE] [--wait]
ctlflow job logs JOB --tenant TENANT [--follow]
ctlflow job delete JOB --tenant TENANT [--force]
```

The Job document identifies its Package, attached account, Context, and Package-defined
configuration and bindings. It may also select concurrency and retry policy supported by the
versioned API schema. Required bindings must be ready before the Job can be enabled.

The attached account and Context are immutable. Changing either means creating a new Job so
principal history and persistent state never silently change ownership.

User-created private Jobs attach to their creator. Administrators creating shared Jobs select an
existing human or service account. A Run cannot start when the Job's Context is no longer reachable
by its attached account.

Deleting a Job removes its Triggers, secret bindings, and virtual principal. Persistent-data
retention follows the explicit Job binding policy. Terminal Runs and Audit Events remain only for
their configured evidence retention.

## Triggers

Triggers are independent, many-per-Job records. Manual invocation is not a Trigger.

```text
ctlflow job trigger list JOB --tenant TENANT
ctlflow job trigger get JOB TRIGGER --tenant TENANT
ctlflow job trigger create JOB --tenant TENANT -f FILE
ctlflow job trigger update JOB TRIGGER --tenant TENANT -f FILE
ctlflow job trigger enable JOB TRIGGER --tenant TENANT
ctlflow job trigger disable JOB TRIGGER --tenant TENANT
ctlflow job trigger delete JOB TRIGGER --tenant TENANT [--force]
```

An Event Trigger names a Package-declared Event type. A schedule Trigger names a recurring schedule
or one future time, with explicit timezone and overlap policy. Every Trigger inherits the Job's
Context. Missed fires are not replayed. Deleting one Trigger does not change the Job or its other
Triggers.

Access grants for the Job principal are managed through [Policy](../policy/), not a second Job-only
grant model.

---
title: Runs
weight: 65
---

A Run is one admitted invocation of a Job.

```text
ctlflow get runs (--global | --tenant TENANT | --all-tenants) \
  [--job JOB] [--placement PLACEMENT]
ctlflow get run RUN (--global | --tenant TENANT)
ctlflow wait run RUN (--global | --tenant TENANT)
ctlflow cancel run RUN (--global | --tenant TENANT) [--force] [--wait]
ctlflow logs run RUN (--global | --tenant TENANT) [--follow]
ctlflow get run-attempts (--global | --tenant TENANT) --run RUN
ctlflow get run-attempt ATTEMPT (--global | --tenant TENANT) --run RUN
ctlflow get run-artifacts (--global | --tenant TENANT) --run RUN
ctlflow get run-artifact ARTIFACT (--global | --tenant TENANT) --run RUN
ctlflow download run-artifact ARTIFACT (--global | --tenant TENANT) \
  --run RUN --output FILE
```

One Job and idempotency key identify at most one Run. Attempts, cancellation, logs, outputs, and
the exact runtime principal for each attempt remain attached to that Run. Cancellation stops
further execution but does not undo a committed external side effect. A terminal outcome is
immutable.

Administrative APIs carry bounded artifact metadata. Upload and download bytes use short-lived,
purpose-bound transfer access from the configured artifact dependency.

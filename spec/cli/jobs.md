---
title: Jobs
weight: 60
---

A Job is reusable finite work at one Placement with one stable virtual principal and attached
account.

```text
ctlflow get jobs (--global | --tenant TENANT | --all-tenants) [--placement PLACEMENT]
ctlflow get job JOB (--global | --tenant TENANT)
ctlflow create job (--global | --tenant TENANT) -f FILE [--wait]
ctlflow apply job JOB (--global | --tenant TENANT) -f FILE [--wait]
ctlflow enable job JOB (--global | --tenant TENANT)
ctlflow disable job JOB (--global | --tenant TENANT)
ctlflow run job JOB (--global | --tenant TENANT) [--input ARTIFACT] [--wait]
ctlflow delete job JOB (--global | --tenant TENANT) [--force] [--wait]

ctlflow get job-schedules (--global | --tenant TENANT) [--job JOB]
ctlflow get job-schedule SCHEDULE (--global | --tenant TENANT)
ctlflow create job-schedule (--global | --tenant TENANT) --job JOB -f FILE
ctlflow apply job-schedule SCHEDULE (--global | --tenant TENANT) -f FILE
ctlflow enable job-schedule SCHEDULE (--global | --tenant TENANT)
ctlflow disable job-schedule SCHEDULE (--global | --tenant TENANT)
ctlflow delete job-schedule SCHEDULE (--global | --tenant TENANT) [--force]
```

Package, Placement, attached account, and virtual principal are immutable. A Run inherits them and
cannot broaden authority. A Schedule is periodic activation for one Job and enters the same Run
admission path as a manual or product request.

Global Jobs require a global service User. A private user Placement requires its exact owning User;
an administrator selects an existing admitted account for shared work.

An agent is a product label for a Job with delegated identity, persistent state, and
product-managed activation or conversation state. CtlFlow has no Agent resource or trigger model.

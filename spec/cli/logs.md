---
title: Logs
weight: 80
---

Program logs are exposed through their owning execution records:

```text
ctlflow app logs APP --tenant TENANT [--component COMPONENT] [--follow]
ctlflow job logs JOB --tenant TENANT [--follow]
ctlflow run logs RUN --tenant TENANT [--follow]
```

Queries are Tenant-fenced, time-bounded, and paginated. `--follow` starts a finite live stream from
the current boundary; no command downloads all retained output implicitly.

These commands read the configured product log store, not arbitrary Pod logs. CtlFlow component and
cluster-operational logs remain in the installation observability system and `kubectl logs`.

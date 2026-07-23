---
title: Logs
weight: 70
---

Program logs are read through their owning App, Job, or Run:

```text
ctlflow logs app APP (--global | --tenant TENANT) [--component COMPONENT] [--since TIME] [--follow]
ctlflow logs job JOB (--global | --tenant TENANT) [--since TIME] [--follow]
ctlflow logs run RUN (--global | --tenant TENANT) [--since TIME] [--follow]
```

Every query is authorization-fenced, time-bounded, and paginated. `--follow` begins a finite stream
at an explicit current boundary; it does not fetch all retained output.

These commands read the configured program-log dependency. Kernel and cluster operational logs
remain in the installation observability system and `kubectl logs`. Audit evidence is separate.

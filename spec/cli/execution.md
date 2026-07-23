---
title: Execution State
weight: 58
---

Workloads, dependency claims and bindings, and endpoints are read-only projections of admitted App
and Job intent.

```text
ctlflow get workloads (--global | --tenant TENANT | --all-tenants) \
  [--app APP] [--placement PLACEMENT]
ctlflow get workload WORKLOAD (--global | --tenant TENANT)

ctlflow get dependency-claims (--global | --tenant TENANT | --all-tenants) \
  [--app APP | --job JOB]
ctlflow get dependency-claim CLAIM (--global | --tenant TENANT)
ctlflow get dependency-bindings (--global | --tenant TENANT | --all-tenants) \
  [--app APP | --job JOB]
ctlflow get dependency-binding BINDING (--global | --tenant TENANT)

ctlflow get endpoints (--global | --tenant TENANT | --all-tenants) \
  [--app APP] [--placement PLACEMENT]
ctlflow get endpoint ENDPOINT (--global | --tenant TENANT)
```

These records expose requested generation, provider Placement, readiness, bounded failure reason,
and observed realization without exposing native Kubernetes names or credentials. Mutations occur
only through the owning App, Job, configuration, provider selection, or Placement constraint; there
is no second workload or binding write path.

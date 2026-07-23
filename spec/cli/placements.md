---
title: Placements
weight: 40
---

A Placement is one execution and persistent-state boundary. There is one canonical Placement for
each valid global, Tenant, Workspace, tenant-user, or workspace-user source.

```text
ctlflow get placements (--global | --tenant TENANT | --all-tenants) \
  [--workspace WORKSPACE] [--user USER]
ctlflow get placement PLACEMENT (--global | --tenant TENANT)
ctlflow suspend placement PLACEMENT (--global | --tenant TENANT) [--wait]
ctlflow resume placement PLACEMENT (--global | --tenant TENANT) [--wait]

ctlflow get placement-constraints (--global | --tenant TENANT | --all-tenants)
ctlflow get placement-constraint CONSTRAINT (--global | --tenant TENANT)
ctlflow apply placement-constraint (--global | --tenant TENANT) -f FILE
ctlflow delete placement-constraint CONSTRAINT (--global | --tenant TENANT) [--force]
```

Tenant and Workspace Placements materialize with their source. User Placements materialize lazily
after an admitted private App, Job, or persistent resource needs them. Operators do not create
arbitrary Placements.

Constraints bound admitted execution, persistence, dependencies, exposure, and network
relationships. Global constraints are the hard ceiling; lower scopes can only narrow inherited
choices. A Placement is a fence, not an application-data grant.

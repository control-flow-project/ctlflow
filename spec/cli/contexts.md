---
title: Contexts
weight: 25
---

A Context names one placement and data boundary. Contexts are derived and read-only.

```text
ctlflow context list --tenant TENANT [--workspace WORKSPACE] [--user USER]
ctlflow context get CONTEXT --tenant TENANT
```

| Kind | Source | Meaning |
| --- | --- | --- |
| `tenant` | Tenant | Shared Tenant state |
| `workspace` | Workspace | Shared Workspace state |
| `tenant-user` | Tenant Membership | One User's private Tenant state |
| `workspace-user` | Workspace Membership | One User's private state in one Workspace |

Apps and Jobs bind to one Context. Every Run inherits its Job's Context. Reusing a Package in
several Contexts means creating a distinct App or Job in each. Removing the source Tenant,
Workspace, User, or Membership stops new work before the derived Context's Kubernetes containment
is retired.

A Context is a fence, not a grant. Running in a Context does not itself permit an application-data
operation.

---
title: Workspaces
weight: 20
---

A Workspace is a collaboration boundary inside one Tenant.

```text
ctlflow get workspaces --tenant TENANT
ctlflow get workspace WORKSPACE --tenant TENANT
ctlflow create workspace --tenant TENANT --name NAME [-f FILE] [--wait]
ctlflow apply workspace WORKSPACE --tenant TENANT -f FILE
ctlflow suspend workspace WORKSPACE --tenant TENANT [--wait]
ctlflow resume workspace WORKSPACE --tenant TENANT [--wait]
ctlflow delete workspace WORKSPACE --tenant TENANT [--force] [--wait]
```

Creation establishes the configuration scope, requested Memberships, canonical Workspace
Placement, and explicitly requested Apps. Suspension blocks new work in the Workspace and its
private user Placements without affecting the rest of the Tenant.

Business records such as matters, projects, clients, stages, and responsible people belong to
product Packages. They are not Workspace fields.

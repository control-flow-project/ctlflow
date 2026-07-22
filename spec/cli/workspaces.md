---
title: Workspaces
weight: 20
---

A Workspace is a collaboration boundary inside one Tenant.

```text
ctlflow workspace list --tenant TENANT
ctlflow workspace get WORKSPACE --tenant TENANT
ctlflow workspace create --tenant TENANT --name NAME [--wait]
ctlflow workspace update WORKSPACE --tenant TENANT -f FILE
ctlflow workspace suspend WORKSPACE --tenant TENANT [--wait]
ctlflow workspace resume WORKSPACE --tenant TENANT [--wait]
ctlflow workspace delete WORKSPACE --tenant TENANT [--force] [--wait]
```

Suspension blocks new activity in the Workspace and its user-private Contexts without affecting the
rest of the Tenant. Deletion coordinates the removal of Workspace-owned records and containment.
Historical evidence may retain opaque Workspace and Context references under its own retention.

Memberships connect Users to a Tenant or Workspace:

```text
ctlflow membership list --tenant TENANT [--workspace WORKSPACE]
ctlflow membership get MEMBERSHIP --tenant TENANT
ctlflow membership add USER --tenant TENANT [--workspace WORKSPACE] [--role admin|member]
ctlflow membership update MEMBERSHIP --tenant TENANT --role admin|member
ctlflow membership remove MEMBERSHIP --tenant TENANT [--force]
```

Without `--workspace`, a Membership is Tenant-scoped. With it, the Membership is scoped to that
Workspace. Scope is immutable; changing scope means removing one relationship and adding another.
Membership grants standing, not application-data permission.

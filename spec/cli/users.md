---
title: Users And Groups
weight: 30
---

Human and ordinary service Users are Tenant-owned. Global service Users are non-login accounts for
global workloads. Memberships give Tenant Users management standing; Groups are reusable policy
audiences.

```text
ctlflow get users (--global | --tenant TENANT | --all-tenants)
ctlflow get user USER (--global | --tenant TENANT)
ctlflow create user (--global | --tenant TENANT) -f FILE
ctlflow apply user USER (--global | --tenant TENANT) -f FILE
ctlflow enable user USER (--global | --tenant TENANT)
ctlflow disable user USER (--global | --tenant TENANT) [--force]
ctlflow delete user USER (--global | --tenant TENANT) [--force]

ctlflow get memberships --tenant TENANT [--workspace WORKSPACE]
ctlflow get membership MEMBERSHIP --tenant TENANT
ctlflow create membership --tenant TENANT -f FILE
ctlflow apply membership MEMBERSHIP --tenant TENANT -f FILE
ctlflow delete membership MEMBERSHIP --tenant TENANT [--force]

ctlflow get groups --tenant TENANT [--workspace WORKSPACE]
ctlflow get group GROUP --tenant TENANT
ctlflow create group --tenant TENANT -f FILE
ctlflow apply group GROUP --tenant TENANT -f FILE
ctlflow delete group GROUP --tenant TENANT [--force]
ctlflow get group-members --tenant TENANT --group GROUP
ctlflow add group-member GROUP PRINCIPAL --tenant TENANT
ctlflow remove group-member GROUP PRINCIPAL --tenant TENANT [--force]

ctlflow get identity-links --tenant TENANT --user USER
ctlflow get identity-link LINK --tenant TENANT --user USER
ctlflow create identity-link --tenant TENANT --user USER -f FILE
ctlflow delete identity-link LINK --tenant TENANT --user USER [--force]
ctlflow get sessions --tenant TENANT --user USER
ctlflow get session SESSION --tenant TENANT --user USER
ctlflow revoke session SESSION --tenant TENANT --user USER [--force]

ctlflow get virtual-principals (--global | --tenant TENANT | --all-tenants)
ctlflow get virtual-principal PRINCIPAL (--global | --tenant TENANT)
ctlflow get runtime-principals (--global | --tenant TENANT | --all-tenants)
ctlflow get runtime-principal PRINCIPAL (--global | --tenant TENANT)
```

Human Users may have identity links and browser sessions. Service Users have neither and exist for
explicit workload delegation. `--global` admits only a service User. Virtual and runtime principals
are read-only projections of admitted App, Job, and execution identity.

Membership scope and User are immutable; `apply` may change only admitted management standing.
Groups are non-nested and membership grants no authority without a matching policy rule.

Disabling a User revokes sessions and new delegated credentials and suspends attached execution.
Deletion is rejected while an App or Job remains attached; CtlFlow never silently reassigns it.

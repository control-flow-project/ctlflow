---
title: Users
weight: 30
---

A User is a Tenant-owned human or service account.

```text
ctlflow user list --tenant TENANT
ctlflow user get USER --tenant TENANT
ctlflow user create --tenant TENANT -f FILE
ctlflow user update USER --tenant TENANT -f FILE
ctlflow user enable USER --tenant TENANT
ctlflow user disable USER --tenant TENANT [--force]
ctlflow user delete USER --tenant TENANT [--force]

ctlflow user link list USER --tenant TENANT
ctlflow user link add USER --tenant TENANT --provider PROVIDER --subject SUBJECT
ctlflow user link remove USER LINK --tenant TENANT [--force]

ctlflow user session list USER --tenant TENANT
ctlflow user session revoke USER SESSION --tenant TENANT [--force]
```

Human Users may hold external identity links and browser sessions. Service accounts hold neither;
they exist for explicit workload delegation.

Disabling a User invalidates its sessions, denies delegated authority, and stops attached workloads
while preserving desired state and history.
Deleting a User removes owned identity state and is rejected while an App or Job remains attached
to the account. CtlFlow never silently reattaches a workload.

---
title: Tenants
weight: 10
---

A Tenant is the customer and top-level isolation boundary.

```text
ctlflow get tenants
ctlflow get tenant TENANT
ctlflow create tenant -f FILE [--wait]
ctlflow apply tenant TENANT -f FILE
ctlflow suspend tenant TENANT [--wait]
ctlflow resume tenant TENANT [--wait]
ctlflow delete tenant TENANT [--force] [--wait]
```

Creation allocates an opaque ID, establishes the initial administrator and configuration scope,
materializes the Tenant Placement, and installs only explicitly requested baseline Apps. The
Tenant remains visible with a stable condition until every step succeeds.

Suspension blocks new Tenant activity without deleting state. Deletion is irreversible and
completes only after each owner has retired its Tenant records and realization. A Tenant document
contains domain policy and display metadata, never Kubernetes object identity.

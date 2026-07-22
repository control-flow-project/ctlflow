---
title: Tenants
weight: 10
---

A Tenant is the customer and isolation boundary.

```text
ctlflow tenant list
ctlflow tenant get TENANT
ctlflow tenant create --name NAME [--wait]
ctlflow tenant update TENANT -f FILE
ctlflow tenant suspend TENANT [--wait]
ctlflow tenant resume TENANT [--wait]
ctlflow tenant delete TENANT [--force] [--wait]
```

Creation allocates an opaque Tenant ID and provisions its domain state and containment. Suspension
blocks new tenant activity while preserving records. Deletion is irreversible, cascades through
Tenant-owned records, and completes only after every owning service and `controller-manager`
acknowledges cleanup.

The Tenant document contains a display name and versioned Tenant-level policy supported by the API.
It never contains infrastructure placement or Kubernetes object identity.

Tenant administrators are Users with a Tenant Membership whose role is `admin`; there is no
separate Tenant-admin account type.

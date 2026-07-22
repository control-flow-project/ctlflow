---
title: Quotas
weight: 27
---

Every Tenant has one Quota record. Quota is an admission policy, not a billing system or a second
inventory.

```text
ctlflow quota get --tenant TENANT
ctlflow quota update --tenant TENANT -f FILE
```

The versioned Quota schema may bound domain record counts, active execution, requested resources,
persistent storage, and retained evidence. The API schema is the single field inventory; this page
does not duplicate it.

Each owning service enforces the bounds relevant to its mutation and reports current usage. If a
bound is lowered below existing usage, existing records remain and subsequent admission is denied
until usage falls within the bound. Quota enforcement never silently deletes state.

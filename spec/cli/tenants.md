---
title: Tenants
description: Operator commands for Tenant creation, reads, updates, lifecycle, and resolution.
weight: 10
---

A Tenant is the customer and top-level isolation boundary.

```text
ctlflow get tenants [--limit COUNT] [--after TENANT_ID]
ctlflow get tenant TENANT
ctlflow create tenant -f FILE
ctlflow update tenant TENANT --revision REVISION --display-name NAME
ctlflow suspend tenant TENANT --revision REVISION
ctlflow resume tenant TENANT --revision REVISION
ctlflow delete tenant TENANT --revision REVISION [--force]
ctlflow resolve tenant ADDRESS
```

The create document contains exactly `tenant_id`, `address`, and `display_name`. The ID and address
are immutable. Create returns an active Tenant and does not create Users, configuration,
Placements, Packages, or Apps.

Update changes only the display name. Suspend, resume, and delete map to `SetTenantState`; all
mutations after create require the current positive revision. Delete is terminal and retains the
record and address. Resolve returns only an active Tenant.

List returns one ID-ordered page. `--after` is the last emitted Tenant ID and is not a stored
cursor.

---
title: Workspaces
description: Operator commands for Workspace creation, reads, updates, lifecycle, and resolution.
weight: 20
---

A Workspace is a collaboration boundary inside one Tenant.

```text
ctlflow get workspaces --tenant TENANT [--limit COUNT] [--after WORKSPACE_ID]
ctlflow get workspace WORKSPACE
ctlflow create workspace --tenant TENANT -f FILE
ctlflow update workspace WORKSPACE --revision REVISION --display-name NAME
ctlflow suspend workspace WORKSPACE --revision REVISION
ctlflow resume workspace WORKSPACE --revision REVISION
ctlflow delete workspace WORKSPACE --revision REVISION [--force]
ctlflow resolve workspace ADDRESS --tenant TENANT
```

The create document contains exactly `workspace_id`, `address`, and `display_name`; `--tenant`
supplies the immutable parent Tenant ID. Create returns an active Workspace and does not create
Memberships, configuration, a Placement, or Apps.

Update changes only the display name. Suspend, resume, and delete map to `SetWorkspaceState`; all
mutations after create require the current positive revision. Delete is terminal and retains the
record and address. Resolve returns only an active Workspace whose parent Tenant is active.

List returns one ID-ordered page inside the exact Tenant. `--after` is the last emitted Workspace ID
and is not a stored cursor.

Business records such as matters, projects, clients, stages, and responsible people belong to
product Packages. They are not Workspace fields.

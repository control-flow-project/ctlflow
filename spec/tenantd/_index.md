---
title: tenantd
weight: 40
---

`tenantd` owns the scope tree and tenant admission bounds.

## Owns

| Record | Scope |
| --- | --- |
| Tenant | Infrastructure |
| Workspace | Tenant |
| Context | Tenant; derived and read-only |
| Quota | One per Tenant |

It serves `tenancy.ctlflow.com/v1alpha1` as `tenants`, `workspaces`, `contexts`, and `quotas`.

## Responsibilities

- Manage Tenant and Workspace lifecycle: provision, suspend, resume, and delete.
- Derive tenant, workspace, tenant-user, and workspace-user Contexts from tenancy and Membership.
- Stop admission when a Context's source is suspended or removed, then retire its Kubernetes
  containment after active work quiesces.
- Store tenant quota policy. Quotas may bound record counts, active execution, resource requests,
  storage, and retained evidence; owning services enforce the bounds relevant to their mutations.
- Publish desired containment state and accept observed status from `controller-manager`.
- Coordinate Tenant deletion through idempotent acknowledgements from every owner of Tenant data.

`tenantd` reads Users and Memberships from `identityd` when deriving user Contexts. It does not own
identity, Apps, Jobs, policy, or Kubernetes resources.

## Containment contract

Every active Context maps to one opaque Kubernetes namespace. Desired containment identifies the
Context indirectly through an opaque realization ID and carries only the requirements needed for
isolation and lifecycle. `controller-manager` owns the native representation.

## Invariants

- A Workspace has exactly one immutable parent Tenant.
- A Context is uniquely derived from its source records and is never client-created.
- Context is placement and data isolation, not permission.
- Suspension preserves records and is reversible; deletion is irreversible.
- New work is denied as soon as its Tenant, Workspace, or Context stops admitting it.
- Quotas gate admission and never destroy already admitted records merely because a bound is
  lowered.

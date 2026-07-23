---
title: tenantd
weight: 40
---

`tenantd` is the authority for the Tenant and Workspace hierarchy and lifecycle.

## Owns

| Record | Scope |
| --- | --- |
| Tenant | CtlFlow installation |
| Workspace | Exactly one Tenant |

It serves `tenants` and `workspaces` in `tenancy.ctlflow.com/v1alpha1`.

## Activities

- Create, read, list, update, suspend, resume, and delete Tenants.
- Create, read, list, update, suspend, resume, and delete Workspaces.
- Allocate opaque IDs and validate bounded display names and unambiguous address segments.
- Own admitted host and path address bindings for Tenants and Workspaces.
- Resolve an exact external Tenant or Workspace address to its canonical ID.
- Return a revision and finite cache expiry with each external address resolution.
- Track provisioning generation, lifecycle, conditions, and bounded failure reasons.
- Coordinate initial administrator, configuration scope, canonical Placement, and explicitly
  requested baseline Apps.
- Stop new child activity before suspension or deletion proceeds.
- Coordinate idempotent cleanup acknowledgements from every owner of child records.

## Provisioning

Tenant creation persists the Tenant in `provisioning`, then advances these idempotent steps:

```text
 identityd  establish initial administrator
 configd    establish Tenant configuration scope
 execd      realize canonical Tenant Placement
 pkgd       reconcile requested baseline Apps
 tenantd    mark Tenant active
```

Workspace creation uses the same shape:

```text
 identityd  establish requested Memberships
 configd    establish Workspace configuration scope
 execd      realize canonical Workspace Placement
 pkgd       reconcile requested Workspace Apps
 tenantd    mark Workspace active
```

The caller may be the operator CLI or an admitted product backend. Business metadata such as matter
type, pipeline stage, client, or responsible person belongs to the calling product application.

Each external step runs after the local transaction commits. The provisioning generation and
idempotency identity make retry safe. A failed step leaves one visible condition and never creates a
second Tenant or Workspace.

## Direct operations

| Operation | Purpose |
| --- | --- |
| ResolveTenant | Resolve one immutable ID or admitted external address with a revision and finite cache expiry |
| ResolveWorkspace | Resolve one Workspace address inside an exact Tenant with a revision and finite cache expiry |
| GetLifecycle | Return current lifecycle and generation for authorization or reconciliation |
| AcknowledgeChildState | Record one idempotent provisioning or deletion step |

External address resolution returns only the canonical Tenant ID, optional Workspace ID, matched
address-binding generation, and expiry needed by `edged`. It does not expose or duplicate the
administrative Tenant or Workspace record. A caller must resolve again after the supplied expiry.

Administrative CRUD and lifecycle changes use the aggregated resources.

## Callers and dependencies

- `edged` resolves external Tenant and Workspace addresses.
- `identityd`, `policyd`, `pkgd`, `configd`, `execd`, `egressd`, and `auditd` validate scope and
  lifecycle through `tenantd`.
- `tenantd` calls `identityd`, `configd`, `execd`, and `pkgd` only as committed lifecycle steps.

## Invariants

- A Workspace has exactly one immutable parent Tenant.
- An admitted host-and-path address resolves to at most one active record in its parent scope.
- Address-resolution cache hints are finite and never transfer address authority to a caller.
- Address grammar keeps user-controlled segments structurally separate from fixed route segments.
- Suspension is reversible and blocks new child activity.
- Deletion is irreversible and cannot complete while an owner reports live child state.
- `tenantd` owns no User, Package, Placement, application, Kubernetes, or business-domain record.
- No service infers Tenant or Workspace truth from Kubernetes namespaces.

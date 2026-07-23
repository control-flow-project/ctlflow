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
| Tenant address binding | Exactly one Tenant |
| Workspace address binding | Exactly one Workspace |

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

## External address model

An external address binding is permanent ownership of one canonical public root. A Tenant binding
contains:

```text
authority
Tenant path prefix
Tenant ID
binding generation
active or retired state
```

The authority is lower-case ASCII DNS form without scheme, user information, port, or trailing dot.
The Tenant path prefix is either `/` for a host-root Tenant or
`/tenants/<tenant-address>` on a shared host. A Tenant address is one lower-case unreserved path
segment. Fixed structural segments and user-controlled address segments occupy different positions,
so no user value competes with `tenants`, `workspaces`, authentication routes, or application route
families.

A Workspace address binding contains one Workspace address segment inside one Tenant. Its public
root is:

```text
<Tenant root>/workspaces/<workspace-address>
```

Tenant and Workspace address segments are publication keys, not record IDs. They are unique only in
their declared parent address scope and never determine ownership or authorization.

An `(authority, Tenant path prefix)` is bound to exactly one Tenant for the installation's
lifetime. A Workspace address is bound to exactly one Workspace for the lifetime of its parent
Tenant. Retiring a binding makes external resolution return not found but does not release the
address. The bound Tenant or Workspace is immutable, and there is no operation that repoints or
reactivates a retired binding.

Tenant and Workspace deletion leaves terminal owner tombstones and all address reservations in
place. Foreign-key deletion is restrictive; neither an administrative delete nor storage
maintenance can cascade away an address reservation.

## ResolveTenant contract

`ctlflow.tenancy.v1.TenantService.ResolveTenant` is the direct lookup used by `edged` and admitted
kernel services. Its request contains two independently presence-tracked selector fields and
requires exactly one:

```text
tenant_id

or

external_address:
  authority
  path_prefix
```

`tenant_id` is an opaque canonical Tenant ID matching
`[a-z0-9][a-z0-9_-]{0,63}`. `external_address` is the exact canonical Tenant root described above.
The caller canonicalizes the external request before lookup; `tenantd` rejects rather than rewrites
non-canonical input.

ID lookup returns an existing Tenant in any retained lifecycle state. External-address lookup
returns only an active address binding whose Tenant is active. There is no alias, ancestor,
nearest-match, or fallback resolution.

The response contains only:

```text
canonical Tenant ID
Tenant lifecycle
Tenant revision
optional matched address-binding generation
cache expiry
```

The cache expiry is computed from server time and the configured positive lifetime, which must be
between one and 60 seconds. It is never stored as Tenant state. The response does not expose display
name, conditions, internal database identity, or another administrative field.

| Outcome | gRPC status |
| --- | --- |
| Missing selector, multiple selectors, malformed ID, or non-canonical address | `INVALID_ARGUMENT` |
| No visible retained ID or active external-address binding | `NOT_FOUND` |
| Missing, invalid, or expired Kubernetes workload token | `UNAUTHENTICATED` |
| Authenticated workload not admitted to resolve Tenants | `PERMISSION_DENIED` |
| Schema or required local persistence unavailable | `UNAVAILABLE` |

Every call requires an authenticated bound Kubernetes ServiceAccount token. An invocation JWT is
optional because address resolution may occur before a human Session is established. Valid W3C
trace context is continued; an absent or malformed parent starts a new trace as required by
[Telemetry](../telemetry/). A valid invocation Tenant fence that excludes the resolved Tenant makes
the result not found. An invalid invocation JWT is unauthenticated; token claims that assert roles,
permissions, scopes, endpoints, or trace context are invalid. Caller identity cannot be supplied in
the request body.

Canonical evidence covers:

- ID lookup for every retained Tenant lifecycle and exact not-found behavior;
- active external-address lookup and invisibility of inactive bindings or inactive Tenants;
- every malformed, missing, and multiple-selector result;
- bound workload authentication, token failure, and caller admission;
- absent, valid, malformed-context, invalid, expired, and cross-Tenant invocation JWT behavior;
- valid trace continuation, malformed-parent replacement, redaction, and bounded Collector outage;
- exact schema-ledger and migration-lock compatibility, migrated file-backed SQLite, restart,
  deadline, and cancellation; and
- the configured one-to-60-second expiry bound through the shipping production process.

## ResolveWorkspace contract

`ctlflow.tenancy.v1.TenantService.ResolveWorkspace` is a separate lookup performed only after
`ResolveTenant` succeeds. Its request contains:

```text
canonical Tenant ID
Workspace address segment
```

The Workspace address is the exact segment following the fixed `/workspaces/` boundary. It cannot
contain a slash, encoded separator, dot segment, empty segment, or non-canonical escaping. The
operation never accepts an authority, chooses a Tenant, or searches another Tenant.

The response contains only:

```text
canonical Workspace ID
Workspace lifecycle
Workspace revision
matched Workspace address-binding generation
cache expiry
```

Resolution returns only an active Workspace binding whose Workspace and parent Tenant are active.
Malformed input is `INVALID_ARGUMENT`; no visible active binding is `NOT_FOUND`; authentication,
admission, persistence, tracing, and the one-to-60-second expiry bound follow `ResolveTenant`.
There is no alias, fallback, or nearest-Workspace match.

## Direct operations

| Operation | Purpose |
| --- | --- |
| ResolveTenant | Resolve one immutable ID or admitted external address with a revision and finite cache expiry |
| ResolveWorkspace | Resolve one Workspace address inside an exact Tenant with a revision and finite cache expiry |
| GetLifecycle | Return current lifecycle and generation for authorization or reconciliation |
| AcknowledgeChildState | Record one idempotent provisioning or deletion step |

External address resolution is always two explicit operations: first the Tenant root, then the
Workspace segment when the route contains the fixed Workspace boundary. Neither operation exposes
or duplicates an administrative record. A caller must resolve again after the supplied expiry.

Administrative CRUD and lifecycle changes use the aggregated resources.

## Callers and dependencies

- `authd` and `edged` resolve external Tenant and Workspace addresses.
- `identityd`, `policyd`, `pkgd`, `configd`, `execd`, `egressd`, and `auditd` validate scope and
  lifecycle through `tenantd`.
- `tenantd` calls `identityd`, `configd`, `execd`, and `pkgd` only as committed lifecycle steps.

## Invariants

- A Workspace has exactly one immutable parent Tenant.
- An admitted Tenant address permanently belongs to exactly one Tenant and is never reassigned,
  including after retirement or Tenant deletion.
- An admitted Workspace address permanently belongs to exactly one Workspace in its Tenant and is
  never reassigned, including after retirement or Workspace deletion.
- A binding's owner is immutable; no operation repoints or reactivates a retired binding.
- Active sibling address roots are non-overlapping under the routing grammar. Tenant-to-Workspace
  nesting occurs only through an explicit fixed structural boundary, so one request has one exact
  hierarchical resolution.
- Address-resolution cache hints are finite and never transfer address authority to a caller.
- Address grammar keeps user-controlled segments structurally separate from fixed route segments.
- Suspension is reversible and blocks new child activity.
- Deletion is irreversible, cannot complete while an owner reports live child state, and leaves a
  terminal owner tombstone plus permanent address reservations.
- `tenantd` owns no User, Package, Placement, application, Kubernetes, or business-domain record.
- No service infers Tenant or Workspace truth from Kubernetes namespaces.

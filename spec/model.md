---
title: Model
weight: 10
---

CtlFlow separates domain ownership from Kubernetes realization. A concept in
this model does not imply a callable operation; operations exist only in
checked versioned contracts.

## Ownership

| Concept | Owner |
| --- | --- |
| Tenant and Workspace | `tenantd` |
| User, Membership standing, Group, Session, virtual principal, runtime principal | `identityd` |
| Role, grant, operation ownership, access decision | `policyd` |
| Package and installed App intent | `pkgd` |
| Configuration and secret custody | `configd` |
| Placement and workload realization intent | `execd` |
| External HTTP destination and mediation policy | `egressd` |
| Required kernel audit evidence | `auditd` |

`authd` and `edged` are public protocol boundaries and own no durable domain
record.

No service reads or writes another service's database.

## Tenant and Workspace

A Tenant contains immutable ID and address, mutable display name, state,
positive revision, and timestamps. A Workspace contains the same fields plus
one immutable parent Tenant.

State is exactly:

```text
active
suspended
deleted
```

Deleted is terminal. IDs and addresses are permanently retained and never
reassigned. Creating a Tenant or Workspace creates no record owned by another
service.

## Identity and standing

A User is human or service. Membership proves current standing in one Tenant
or Workspace and carries no Role, grant, capability, or administrator flag.
Groups are non-nested direct audiences and grant no authority by themselves.

A virtual principal has one immutable attached account. For a virtual Actor,
effective policy authority requires matching authority for both:

```text
virtual Actor
AND attached account
```

Invocation tokens carry identity and target-fence facts, never permission
snapshots.

## Policy

Policy is allow-only. One immutable operation token has one owner and one
canonical resource-path grammar. A rule matches either one exact path or a
delimiter-bounded subtree.

No matching rule is deny. Missing current target standing is concealed as not
found rather than exposed as policy detail.

## Placement and realization

Placement means where execution and persistent state belong. It is a domain
fence, not a grant. Kubernetes namespaces, workloads, Services, volumes, and
provider custom resources are derived implementation objects rather than
CtlFlow domain records.

`execd` is the only general kernel owner that realizes CtlFlow workload intent
through the Kubernetes API. `configd` has the sole narrow exception for secret
custody and projections.

Exact Placement, Package, App, Job, Run, dependency, and endpoint shapes are
defined only when their owning versioned contracts define operations that use
them.

## Audit and telemetry

Audit events are immutable typed domain evidence accepted by `auditd`.
OpenTelemetry traces, metrics, and logs are bounded operational projections.
Telemetry never replaces audit evidence or domain state.

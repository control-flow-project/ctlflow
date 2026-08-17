---
title: Model
description: Kernel records, ownership, scope, placement, and identity relationships.
weight: 10
---

CtlFlow separates domain ownership from Kubernetes realization. A concept in
this model does not imply a callable operation; operations exist only in
checked versioned contracts.

## Ownership

| Concept | Owner |
| --- | --- |
| Tenant and Workspace | `tenantd` |
| Account, Membership standing, Group, external identity link, login-provider registration, Workspace provider admission, Session, virtual principal, invocation identity | `identityd` |
| Role, grant, kernel operation catalog, access decision | `policyd` |
| Package operation declaration | `pkgd` |
| Admitted Workload operation authority | `execd` |
| Package and installed App intent | `pkgd` |
| Configuration and secret custody | `configd` |
| Placement, Workload, Run, App-storage binding, and realization intent | `execd` |
| Bound external HTTP admission and mediation | `egressd` |
| Required kernel audit evidence | `auditd` |

`authd`, `edged`, and `egressd` are protocol boundaries and own no durable
domain record. Egressd's strict projected binding is process configuration,
not an independently mutable destination record.

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

A User is represented by a `user:` human account principal or `service:`
service account principal. An `agent:` virtual principal has one immutable
attached human or service account and one immutable Tenant fence with an
optional narrower Workspace fence.

A Tenant Membership proves current account standing in one Tenant. A
Workspace Membership requires that Tenant Membership and proves current
standing in one Workspace. Membership carries no Role, grant, capability, or
administrator flag.

Groups are globally identified, non-nested direct audiences at one exact
Tenant or Workspace target. Direct Group membership grants no authority by
itself.

A virtual principal has one immutable attached account. For a virtual Actor,
effective policy authority requires matching authority for both:

```text
virtual Actor
AND attached account
```

Invocation tokens carry identity and target-fence facts, never permission
snapshots.

An external identity link has one generated opaque ID and maps one exact
Tenant, provider ID, and provider subject to one human account. The opaque ID
correlates typed audit evidence and is not part of the identity API. A Tenant
login-provider registration stores
non-secret display and state metadata plus exact Configd configuration and
secret version references. A Workspace provider admission stores only the ID
of one provider in its parent Tenant. Identityd never stores provider material
or interprets OIDC.

A browser Session contains an opaque generated ID, one human account, one
Tenant fence, the immutable login provider used to create it, a digest of a
one-time credential, finite lifetime, revocation state, and positive revision.
Workspace exchange additionally requires a current admission for that
provider. Raw Session credentials and invocation-signing private keys are
never persisted as domain records.

## Policy

Policy is allow-only. Every operation has one tagged identity
`(owner kind, owner ID, operation)` and one canonical resource-path grammar. A
kernel operation is owned by its fixed catalog service; a package operation is
namespaced by the Package ID that declares it, so the same token under two
Packages is two operations. A rule matches either one exact path or a
delimiter-bounded subtree.

No matching rule is deny. Missing current target standing is concealed as not
found rather than exposed as policy detail.

## Packages and installed Apps

A Package is an installation-global lineage of immutable positive
generations. Each generation has one Semantic Version, source provenance,
digest-bound OCI component artifacts, provided interfaces, named exposures,
component-owned product operation declarations, and open typed dependencies
with stable names, optional explicit IDs, and bounded consumer options.
Generations are sequential and permanently retained.
A dependency is a provider-generic requirement rather than a binding or
provisioning request, and an exposure is a declaration rather than a route or
grant.

An App is globally identified installed intent in one closed Global, Tenant,
Workspace, or User scope. Workspace scope includes its parent Tenant; User
scope includes its Tenant and human or service account principal. Its
Placement reference, Package identity, and scope are immutable. Only its
desired Package generation changes under a positive optimistic-concurrency
revision. Pkgd owns that expected scope and reference; Execd owns the
referenced Placement and requires exact scope equality before realization.

## Configuration and secret custody

A Configuration and a Secret each have one immutable identity and one binding
to an Execd-owned Placement, consumer, and purpose. Each publication creates
one immutable version and advances the identity's positive revision.
Configuration versions contain bounded non-secret JSON and may be read by
exact version through their management operation. Secret versions contain only
encrypted opaque material and have no material-read operation.

Provider-generated output enters the same Configd-owned version model only
after Configd validates the exact current Execd-owned dependency claim selected
by the request's claim ID and positive revision. The selector is not authority,
and Configd owns no parallel claim record.

A projection is Configd-owned desired state keyed by exact data kind and
ConsumerBinding. Its convention-derived ID, kind, binding, and first target
identity are immutable; selected version may change. Execd alone applies and
mounts the projection without receiving content. Configuration may select any
retained version; secret may select only its current version.

## Placement and realization

Placement means where execution and persistent state belong. It is a domain
fence, not a grant. Kubernetes namespaces, workloads, Services, volumes, and
provider custom resources are derived implementation objects rather than
CtlFlow domain records.

`execd` is the only general kernel owner that realizes CtlFlow workload intent
through the Kubernetes API. `configd` has the sole narrow exception for secret
custody and projections.

A Placement contains one immutable Global, Tenant, Workspace, or User target,
required parentage, narrowing constraints, desired state, and observed
realization status. A Workload is reusable continuous or finite intent and
stores an admitted Package-component snapshot. A Run is one immutable
admission of one finite Workload revision. There is no separate Job record;
Kubernetes Job is one possible realization of a Run.

Execd-owned intent remains authoritative when Kubernetes objects are absent,
edited, or unavailable. Native state updates bounded observed status and
never becomes another domain-write path.

## Audit and telemetry

Audit events are immutable typed domain evidence accepted by `auditd`.
OpenTelemetry traces, metrics, and logs are bounded operational projections.
Telemetry never replaces audit evidence or domain state.

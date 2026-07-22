---
title: Model
weight: 10
---

CtlFlow has a small domain model. Each noun exists because it owns durable intent or evidence that
cannot be delegated to Kubernetes.

## Core records

| Record | Owner | Meaning |
| --- | --- | --- |
| Tenant | `tenantd` | Customer and isolation boundary |
| Workspace | `tenantd` | Collaboration boundary inside a Tenant |
| Context | `tenantd` | Concrete placement and data boundary |
| Quota | `tenantd` | Tenant admission bounds |
| User | `identityd` | Human or service account belonging to one Tenant |
| Membership | `identityd` | A User's tenant or workspace standing |
| Identity link | `identityd` | External provider subject bound to a human User |
| Session | `identityd` | Opaque human browser session |
| SSO provider | `identityd` | Tenant identity-provider configuration |
| Admission policy | `identityd` | Providers accepted at Tenant or Workspace entry |
| Package | `catalogd` | Immutable versioned App or Job definition |
| Resource profile | `catalogd` | Operator-approved execution sizing |
| App | `execd` | Installed long-running package in one Context |
| Job | `execd` | Reusable finite-work definition with delegated identity |
| Trigger | `execd` | One event or schedule activation for a Job |
| Run | `execd` | One invocation of a Job |
| Event | `eventd` | Immutable application fact published by a workload |
| Event delivery | `eventd` | Delivery outcome for one Event and Trigger |
| Access grant | `policyd` | Allow-only operation on an application resource path |
| Egress destination | `egressd` | Approved external HTTP endpoint and mediation rules |
| Egress policy | `egressd` | Which workload principals may use a destination |
| Audit event | `auditd` | Immutable security and activity evidence |
| Audit export | `auditd` | Bounded asynchronous extraction of Audit Events |

Identifiers are opaque, server allocated, and prefixed by kind, for example `ten-*`, `wsp-*`,
`ctx-*`, `usr-*`, `pkg-*`, `app-*`, `job-*`, and `run-*`. Display names are never identity and do
not determine ownership or authorization.

```text
 Tenant
   |
   +-- Workspace
   +-- User -- Membership
   +-- Context
   |     +-- App -- component principals
   |     +-- Job -- Trigger -- Run
   +-- Event
   +-- Access grant
   +-- Egress policy
   +-- Audit event

 Package --------------------> App or Job
 Egress destination ---------> Egress policy
```

## Context

A Context answers one question: **where does this state and execution belong?** It is not an access
grant.

| Kind | Source | Boundary |
| --- | --- | --- |
| `tenant` | Tenant | Shared tenant state |
| `workspace` | Workspace | Shared state in one Workspace |
| `tenant-user` | Tenant Membership | One User's private tenant-level state |
| `workspace-user` | Workspace Membership | One User's private state in one Workspace |

Contexts are derived from Tenants, Workspaces, Users, and Memberships; clients do not create them
directly. They are materialized with their source record and retired when that source is removed.
Each active Context maps to one opaque Kubernetes containment namespace. Removing the source of a
Context stops new work before its containment is retired.

Every App and Job has one immutable Context. Every Run inherits its Job's Context. A User's current
membership must make that Context reachable, but reachability alone grants no application-data
permission. Reusing one Package in several Contexts means creating a distinct App or Job in each.

Internal service bindings are explicit and may point only inward through the Context hierarchy:

```text
 tenant-user ------> tenant
 workspace --------> tenant
 workspace-user ---> workspace, tenant-user, tenant
```

A binding may also remain inside its exact Context. It can never cross Tenant, Workspace, or User
boundaries sideways. `execd` validates the binding and `controller-manager` realizes only the
corresponding network path. Network reachability still does not replace downstream authorization.

## Packages, Apps, and Jobs

A Package is an immutable, infrastructure-wide definition. It contains digest-pinned OCI images
and one of two contracts:

- an **App package** declares one or more components intended to remain available or to run during
  App lifecycle operations;
- a **Job package** declares one finite component used for each Run.

Packages describe semantic requirements rather than native Kubernetes objects. They may declare
configuration, ports, health checks, persistent-data slots, secret slots, provided or required
service endpoints, application operation tokens, and event types. Provider-specific and
Kubernetes object names are forbidden.

An App installs an App package into one Context. It binds package configuration and declared
slots, attaches to one existing User account, and owns its component status. Each component has a
distinct virtual principal.

A Job configures a Job package for repeated execution in one Context. It has one virtual principal,
attaches to one existing User account, and may have many independent Triggers. A Run is one
invocation and inherits the Job's Context while recording its requester or Trigger, lifecycle,
logs, and outputs.

An **agent** is a product label for a Job that uses delegated identity, persistent state, and often
Triggers. CtlFlow has no separate Agent record, API, or CLI noun.

```text
 App package ---- install ----> App ---- realize ----> long-running components

 Job package ---- configure --> Job ---- invoke -----> Run ---- realize ----> finite work
                                      ^
                                      |
                              manual, event, schedule
```

Persistent-data, secret, and internal-endpoint bindings belong to the App or Job that consumes
them. Their package-declared names remain stable across replacement executions. Secret values are
write-only and remain in Kubernetes Secret custody.

## Identity and authority

A User is either a human account or a service account. Every App and Job attaches to one existing,
enabled User. User-created private workloads attach to their creator; an administrator creating a
shared workload selects the attached account explicitly.

App-component and Job principals are virtual principals, distinct from both the attached account
and the concrete Pod identity. Their authority can only be narrower than the attached account:

```text
 effective authority
   = attached account authority
   AND virtual-principal grants
   AND package capability ceiling
   AND concrete Context fence
   AND current lifecycle policy
```

Audit records both the virtual principal and attached account. Replacing a Pod changes runtime
identity but not the App-component or Job principal.

## Events, logs, and artifacts

An Event is an immutable fact published by an authenticated App component or Run. Its type must be
declared by the publisher's Package. An event Trigger matches a declared type in one Context and
asks `execd` to create one Run. Delivery is retryable; Run creation is idempotent for an
Event/Trigger pair.

Logs are program output held by the configured log system. CtlFlow exposes bounded, authorized
queries and finite follow streams; it does not treat logs as domain records.

Run inputs, outputs, and audit exports may refer to bulk objects in configured object storage.
CtlFlow stores bounded metadata such as media type, size, and digest. Bytes move through
short-lived, purpose-bound transfer paths and never through administrative resource bodies.
Run artifacts belong to the Run's Context and cannot be attached as input across Contexts.

## Lifecycle

The externally meaningful lifecycle vocabulary is deliberately small:

| Record | Lifecycle |
| --- | --- |
| Tenant, Workspace | `provisioning`, `active`, `suspended`, `deleting` |
| Context | `active`, `retiring`, `retired` |
| App | `pending`, `active`, `suspended`, `removing` plus readiness conditions |
| Package | `available` or terminal `revoked` |
| Job, Trigger, User, provider, destination | Enabled or disabled |
| Run | `admitted`, `running`, `succeeded`, `failed`, `cancelled` |
| Audit Export | `pending`, `running`, `succeeded`, `failed`, `expired` |

A deleted record no longer exists; `deleted` is not a stored state. Failure detail is a stable
condition or reason attached to the current state, not a parallel lifecycle.

Deletion follows two rules:

- **Owned children follow their owner.** Removing a Job removes its Triggers and eventually its
  retained Runs according to policy.
- **Independent references block deletion.** A referenced account, provider, or destination cannot
  be deleted until the reference is removed. Immutable catalog records are not deleted in this
  architecture.

Suspension is reversible and blocks new activity without discarding records. Deletion is
irreversible. Cross-service deletion is coordinated through explicit lifecycle state and
idempotent acknowledgements; no service writes another service's database.

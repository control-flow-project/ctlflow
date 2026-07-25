---
title: Model
weight: 10
---

CtlFlow has a small domain model. Each record exists because it owns durable intent or evidence
that cannot be delegated to Kubernetes.

## Record ownership

| Record | Owner | Meaning |
| --- | --- | --- |
| Tenant | `tenantd` | Customer and top-level isolation boundary |
| Workspace | `tenantd` | Collaboration boundary inside one Tenant |
| Tenant address binding | `tenantd` | Permanent external address owned by one Tenant |
| Workspace address binding | `tenantd` | Permanent external address owned by one Workspace |
| Lifecycle operation and step acknowledgement | `tenantd` | Revisioned cross-owner progress for one Tenant or Workspace generation |
| User | `identityd` | Human or service account at global or Tenant scope |
| Membership | `identityd` | A User's standing in a Tenant or Workspace |
| Group and Group member | `identityd` | Reusable Tenant- or Workspace-scoped audience |
| Identity link | `identityd` | External provider subject bound to a human User |
| SSO provider and admission rule | `identityd` | Tenant login configuration and Workspace narrowing |
| Login transaction | `identityd` | Short-lived one-use provider, origin, and return binding |
| Session | `identityd` | Opaque human browser session |
| Virtual principal | `identityd` | Stable delegated identity for one App component or Job |
| Runtime principal | `identityd` | Identity of one concrete workload execution |
| Role, Role binding, Access grant, and Access review | `policyd` | Path-and-operation authorization state and decision |
| Package and artifact | `pkgd` | Immutable versioned application or finite-work contract |
| App | `pkgd` | One App Package installed in one Placement |
| App generation | `pkgd` | Immutable desired App state pinned to one Package version |
| Service contract and exposure | `pkgd` | Declared peer-service compatibility and external surface |
| Application operation and provider contract | `pkgd` | Application operation ownership and dependency schema |
| Configuration | `configd` | Versioned non-secret value at one supported scope |
| Secret | `configd` | Write-only secret identity, policy, version, and custody binding |
| Secret version and projection | `configd` | Append-only custody version and authorized runtime binding |
| Provider configuration | `configd` | Selected dependency provider and its admitted options |
| Resolved generation | `configd` | Complete immutable configuration for one consumer |
| Placement | `execd` | Concrete execution and persistent-state boundary |
| Placement constraints | `execd` | Inherited typed execution and dependency ceiling |
| Workload | `execd` | Desired long-running realization of one App component |
| Persistent slot | `execd` | Stable Placement-owned filesystem identity for one consumer slot |
| Job | `execd` | Reusable finite-work definition |
| Schedule | `execd` | Periodic activation belonging to one Job |
| Run | `execd` | One admitted Job invocation |
| Run attempt and artifact metadata | `execd` | Concrete execution attempt and bounded output identity |
| Dependency claim and binding | `execd` | Desired dependency and its resolved runtime outputs |
| Endpoint | `execd` | Ready internal address for one realized component |
| Egress destination, policy, and review | `egressd` | Approved external HTTP target, admitted callers, and decision |
| Audit event, payload deletion event, and export | `auditd` | Authoritative evidence and bounded extraction |

Identifiers are opaque, server allocated, and prefixed by kind. Display names, slugs, Package names,
logical bucket names, and Kubernetes names never determine ownership or authorization.

## Tenancy and Placements

A Tenant owns its Workspaces and accounts; the installation owns global service accounts. A
Placement answers one question: **where do execution and persistent state belong?** It is a fence,
not a grant.

| Placement kind | Source | Meaning |
| --- | --- | --- |
| `global` | CtlFlow installation | Infrastructure-wide shared execution |
| `tenant` | Tenant | Shared Tenant execution and state |
| `workspace` | Workspace | Shared Workspace execution and state |
| `tenant-user` | Tenant Membership | One User's private Tenant execution and state |
| `workspace-user` | Workspace Membership | One User's private Workspace execution and state |

There is one canonical Placement for each valid source tuple. Global, Tenant, and Workspace
Placements materialize with their source. User Placements materialize on the first admitted private
App, Job, or persistent resource. Each materialized Placement maps to one opaque Kubernetes
namespace. Removing or suspending its source stops new work before retirement begins.

Every App and Job has one immutable Placement. Every Run inherits its Job's Placement. Installing
the same Package at another Placement creates another App or Job with separate identity, state,
dependencies, endpoints, and realization.

Placement constraints are typed `execd` state. They bound execution class, lifetime, scale,
resources, persistence, dependency types and providers, exposure, and network reachability.
Operator constraints are the hard ceiling. Tenant, Workspace, and user configuration may only
narrow inherited choices. A request outside the effective constraints is rejected rather than
silently modified.

## Packages, Apps, Jobs, and Runs

A Package is immutable and versioned. It is owned at global, Tenant, Workspace, or user
scope and carries explicit provenance and trust. Visibility and permitted target Placements follow
that ownership and policy.

An App Package declares one or more components. A component may declare:

- a digest-pinned OCI image;
- continuous or lifecycle execution intent;
- ports, health, and external exposure;
- configuration fields and secret slots;
- persistent filesystem slots;
- named dependencies and the components that use them;
- provided service contracts;
- application operation tokens; and
- resource requirements within Placement constraints.

A Job Package declares one finite component and its configuration, dependencies, persistent slots,
input, output, and resource requirements.

An App installs one App Package at one Placement. Each App generation pins one immutable Package
version; an explicit compatible upgrade creates a new generation without changing the App,
Placement, attached account, or persistent-slot identities. A Job configures one immutable Job
Package version for repeated execution at one Placement. An App component and a Job each receive a
stable virtual principal attached to one existing User valid for that Placement. A Run is one
invocation of a Job and records its requester, idempotency identity, attempts, status, outputs, and
concrete runtime principal for each attempt.

```text
 App Package ---- install ----> App ----> Workload ----> Kubernetes workload

 Job Package ---- configure --> Job ----> Run ----------> Kubernetes Job
                                      ^
                                      |
                           user, service, schedule,
                           or product-owned automation
```

An agent is a product label for a Job with a virtual principal, persistent state, and
product-managed activation or conversation state. CtlFlow has no separate Agent execution path.

## Configuration and secrets

Package and provider schemas are immutable declarations owned by `pkgd`. `configd` owns values
validated against those declarations.

Configuration can be written at global, Tenant, Workspace, tenant-user, workspace-user, App, or Job
scope when the declaration permits it. `configd` produces one complete, revisioned resolved
configuration for each consumer. Inheritance is deterministic:

```text
 global < tenant < workspace < tenant-user < workspace-user < App-or-Job override
```

Only scopes applicable to the target Placement participate. A lower scope can override only fields
declared overrideable there. Policy and Placement constraints are intersections, not last-writer
configuration.

Secret material is submitted through write-only operations. Reads return metadata, version, policy,
and readiness, never the value. `configd` materializes a secret only into an authorized Kubernetes
binding or an authorized `egressd` request. Rotation creates a new version and explicitly rolls
affected consumers.

## Dependencies

A Package declares every external capability as a named dependency:

```yaml
dependencies:
  - name: database
    type: postgresql
    version: ">=16"
    options:
      extensions: [pgvector]
    env:
      PGHOST: CHAT_DB_HOST
      PGDATABASE: CHAT_DB_NAME
```

Common fields are:

| Field | Meaning |
| --- | --- |
| `name` | Immutable Package-local dependency name |
| `type` | Open dependency contract key |
| `version` | Optional provider-version constraint |
| `options` | Consumer choices allowed by the dependency contract |
| `env` | Optional canonical-output to container-environment renames |

Peer services use `service:<contract>`, for example `service:tasks`. Kernel operations use
`kernel:<contract>`, for example `kernel:policy` or `kernel:execution`. A contract identifies
compatibility, not a URL, Kubernetes Service, or caller-owned copy of the provider's API schema.

Dependencies resolve in three ways:

1. an open provider type such as `postgresql` selects an installed Kubernetes controller and an
   exact provider Placement;
2. `service:<contract>` selects an exact App component at an admitted provider Placement; or
3. `kernel:<contract>` resolves to its fixed owning kernel service and has no selectable provider.

`execd` creates a stable dependency claim and accepts only outputs declared by the dependency
contract. Provider and peer-service claims name their selected provider Placement. A binding
contains typed ordinary values, secret references, endpoint references, mounts, generation, and
readiness. A shared provider must return consumer-specific outputs and namespaces. A kernel
binding contains only its fixed endpoint and admitted operations. The binding contains no
provider-specific interpretation. Only components listing the dependency in `uses` receive those
outputs.

There is no nearest-provider search, fallback provider, or allow-unless-denied behavior. Admission
requires the dependency contract to be installed and requested by the Package. A selectable
provider must also be explicit, allowed for the consumer and provider Placements, and fully
configured. A kernel binding must be explicitly admitted for that Package and Placement.

## Provider Placements and service bindings

Every selectable external or `service:*` provider is owned at one Placement. A consumer may select
only itself or one admitted ancestor in this table:

```text
 global          -> global
 tenant          -> tenant, global
 tenant-user     -> tenant-user, tenant, global
 workspace       -> workspace, tenant, global
 workspace-user  -> workspace-user, workspace,
                    tenant-user for the same User, tenant, global
```

Sibling Workspace, different User, and cross-Tenant providers are forbidden. An external system may
run outside Kubernetes, but its CtlFlow provider identity, configuration, consumer namespace, and
lifecycle remain owned by the selected provider Placement.

An App component may provide a named HTTP, gRPC, or TCP endpoint for one versioned service
contract. A consumer names one declared `service:*` dependency. Before the consumer starts, `execd`
resolves that dependency to one exact provider App, component, and endpoint.

Reachability remains separate from the receiving application's object authorization.

Kubernetes DNS and Services carry internal traffic directly. `edged` is not in the internal path.
Endpoint rotation changes derived realization without changing the Package dependency name.

## Kernel bindings

A `kernel:*` dependency names one versioned public kernel contract owned by its daemon. It resolves
to the installation endpoint and admitted operations, not to a Package or Placement provider. Any
Placement may use an explicitly admitted kernel binding, but that binding grants no Tenant,
Workspace, or application-data authority. The receiving kernel service authenticates the immediate
Kubernetes workload and optional invocation identity and authorizes each requested operation
independently.

## Call identity

Every authenticated application call establishes:

| Fact | Meaning |
| --- | --- |
| Actor | Principal whose authority initiated the operation |
| Subject account | User whose authority bounds the invocation |
| Immediate caller | Kernel service, App component, or Run making this hop |
| Caller account | Account bounding that workload |
| Source Placement | Placement of the caller |
| Runtime principal | Concrete caller process |
| Invocation token ID | Short-lived delegated identity assertion, when present |
| Trace and span IDs | Standard operational and audit correlation |

A request through an exposure explicitly admitting unauthenticated external traffic has no Actor,
subject account, or source Placement. `edged` remains its authenticated immediate caller. That
request cannot be converted into a human invocation.

A trusted runtime proxy fronts each workload endpoint. It authenticates the bound Kubernetes
ServiceAccount token, validates the optional `identityd` invocation JWT, removes caller-supplied
protected headers, and supplies trusted context to the application. For an outbound call, the
application selects only a declared dependency name. The proxy presents its own workload identity
and propagates the current invocation JWT unchanged.

The invocation JWT has one installation-scoped internal audience, a maximum 60-second lifetime, and
no permission or endpoint claims. `identityd` is not called at each hop. An autonomous call omits
the token and acts as the calling virtual principal. Raw TCP bindings carry workload identity only
because they have no portable per-request invocation boundary.

## Persistent state and bulk data

Persistent filesystem slots become Placement-owned PVCs mounted only into declared consumers.
SQLite is an application library over such a mount. Databases, caches, and object stores outside
the application process are dependencies.

Logical resource names are local to one App or Job dependency. A provider gateway may present a
standard S3-compatible surface while deriving the physical namespace from authenticated Tenant,
Placement, App or Job, dependency, bucket, and key facts. Two installations using bucket `users`
never share objects.

Run artifacts and audit exports store bounded metadata such as media type, length, digest, and
transfer state. Bytes move through short-lived purpose-bound transfer paths and never through
administrative resource bodies.

## Identity and effective authority

A User is human or service. Human Users and ordinary service Users belong to one Tenant. A global
service User belongs to the installation, cannot sign in, and can bound only global workloads.
Every App component and Job virtual principal attaches to one existing, enabled User admitted for
its Placement:

- global work attaches to a global service User;
- Tenant and Workspace work attaches to a User with current standing there; and
- tenant-user and workspace-user work attaches to the exact User that owns the Placement.

User-created private workloads therefore attach to their creator. An administrator creating shared
work selects an existing admitted human or service User explicitly.

```text
 effective request authority through a workload
   = Actor authority
   AND Actor attached-account authority when Actor is virtual
   AND immediate-caller attached-account authority
   AND immediate-caller virtual-principal grants
   AND Package capability ceiling
   AND Placement fence and constraints
   AND dependency and network admission
   AND current lifecycle
```

The requester of a Run is evidence, not ambient authority. Replacing a Pod changes runtime identity
without changing the virtual principal or attached account.

Groups are reusable Tenant- or Workspace-scoped audiences. Group membership grants no authority by
itself; `policyd` grants may name a Group. Product roles, teams, committees, and distribution lists
use Groups rather than overloading CtlFlow administration roles.

## Lifecycle

| Record | Lifecycle |
| --- | --- |
| Tenant, Workspace | `provisioning`, `active`, `suspended`, `deleting`, `failed`, or terminal `deleted` |
| Placement | `provisioning`, `active`, `suspended`, `retiring`, `retired`, or `failed` |
| Package | `available` or terminal `revoked` |
| App | `pending`, `active`, `suspended`, `removing`, or `failed` |
| Job, schedule, User, provider, destination | Enabled or disabled |
| Run | `admitted`, `running`, `succeeded`, `failed`, or `cancelled` |
| Audit export | `pending`, `running`, `succeeded`, `failed`, or `expired` |

Suspension is reversible and blocks new activity without discarding records. Deletion is
irreversible. Owned children follow their owner; independent references block deletion until
removed. A deleted Tenant or Workspace remains as a minimal terminal tombstone, and its retired
external address bindings remain permanently reserved. Cross-service cleanup uses explicit
lifecycle state and idempotent acknowledgements. No service reads or writes another service's
database.

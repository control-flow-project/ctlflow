---
title: Services
weight: 25
---

CtlFlow has nine kernel services. Each service owns its records, invariants, schema, and status.
`execd` additionally owns general Kubernetes realization for CtlFlow workloads.

| Service | Authority |
| --- | --- |
| [`tenantd`](../tenantd/) | Tenants and Workspaces |
| [`identityd`](../identityd/) | Accounts, groups, memberships, authentication, sessions, and delegated principals |
| [`policyd`](../policyd/) | Roles, grants, and path-and-operation decisions |
| [`pkgd`](../pkgd/) | Packages, artifacts, service contracts, exposures, and Apps |
| [`configd`](../configd/) | Configuration, secrets, and provider configuration |
| [`execd`](../execd/) | Placements, constraints, workloads, dependencies, Jobs, Runs, endpoints, and realization |
| [`edged`](../edged/) | External ingress mediation and bounded derived caches; no route authority |
| [`egressd`](../egressd/) | External HTTP destinations, policy, and mediation |
| [`auditd`](../auditd/) | Kernel audit evidence and exports |

Application domains remain outside this list. A distro installs Chat, Files, Tasks, Notifications,
realtime, event delivery, agent management, and its vertical applications as Packages.

## Primary paths

```text
 operator -> Kubernetes API -> owning service

 browser -> edged -> product or domain App -> owning service
              |              |
              +-> identityd  +-> identityd / policyd
              +-> policyd
              +-> pkgd
              +-> execd

 tenantd -> identityd / configd / execd / pkgd
 pkgd ----> identityd / configd / execd
 execd ---> tenantd / identityd / pkgd / configd / policyd -> Kubernetes

 App or Run -> runtime proxy -> bound App
 App or Run -----------------> egressd -> approved external HTTP

 every kernel service -------> auditd
```

Arrows mean an API call or revisioned projection, not shared storage. A hot-path service may cache a
revisioned fact, but the cache is rebuildable and bounded by its owner's lifecycle contract.

## Service interactions

| Caller | Callee | Purpose |
| --- | --- | --- |
| Product backend | `identityd` | Obtain an exact-audience management credential from trusted actor context |
| Owning service for product management | `identityd`, `policyd` | Establish the current caller and authorize the exact management operation |
| `tenantd` | `identityd` | Establish initial administrators and validate lifecycle references |
| `tenantd` | `configd` | Establish and retire Tenant and Workspace configuration scopes |
| `tenantd` | `execd` | Materialize, suspend, resume, and retire canonical Placements |
| `tenantd` | `pkgd` | Reconcile explicitly requested bootstrap Package installations |
| `identityd` | `tenantd` | Validate Tenant and Workspace scope and lifecycle |
| `identityd` | `pkgd`, `execd` | Validate App, Job, endpoint, Placement, and virtual-principal references |
| `identityd` | `egressd` | Perform admitted OIDC discovery and token exchange |
| `policyd` | `tenantd`, `identityd`, `pkgd`, `execd` | Resolve current scope, subject, Package ceiling, and Placement fence |
| `pkgd` | `tenantd`, `identityd` | Validate ownership scope, attached account, and target standing |
| `pkgd` | `configd` | Validate installation configuration readiness |
| `pkgd` | `execd` | Build Package artifacts and realize or retire App components |
| `configd` | `tenantd`, `identityd` | Validate configuration scope and user boundary |
| `configd` | `pkgd` | Resolve immutable Package and provider schemas |
| `configd` | `execd` | Validate target Placement and materialize its authorized Secret projection |
| `execd` | `tenantd`, `identityd`, `pkgd`, `configd`, `policyd` | Admit and realize Placement execution |
| `edged` | `tenantd`, `identityd`, `policyd`, `pkgd`, `execd` | Resolve and authorize one external target |
| `egressd` | `identityd`, `configd`, `execd` | Establish runtime identity, secret substitution, and Placement binding |
| `auditd` | `tenantd`, `identityd`, `policyd` | Fence evidence queries and payload-removal authority |
| `auditd` | `configd` | Resolve retention and configured export-storage binding |
| `auditd` | `egressd` | Reach configured export storage when that binding requires external HTTP |
| Provider controller or App | `configd`, `egressd` | Submit claim-bound secret outputs and use admitted external HTTP |
| Every kernel service | `auditd` | Deliver idempotent evidence; durable mutations use a transactional outbox |

No service holds a database transaction while making one of these calls. A multi-service lifecycle
operation persists its local step, commits its audit outbox, and advances idempotently.

## Runtime paths

```text
 browser or external client
             |
             v
           edged ---- session validation ----> identityd
             |
             +---- authorization ------------> policyd
             |
             +---- exposure -----------------> pkgd
             |
             +---- endpoint -----------------> execd
             |
             v
       target runtime proxy ----> App

 App A ---- declared service binding + audience credential ----> App B

 App or Run ---- declared kernel binding + audience credential -> owning kernel service

 App or Run ---- process-bound proxy credential ----> egressd ----> approved origin
```

Internal App calls use Kubernetes Services directly and preserve actor context through
audience-bound credentials. They do not traverse `edged`.

## Ownership rules

- Only `tenantd` mutates Tenant or Workspace lifecycle.
- Only `identityd` establishes account, session, virtual-principal, or runtime identity.
- Only `policyd` mutates grants or produces authoritative path-and-operation reviews.
- Only `pkgd` publishes Packages and mutates App installation intent.
- Only `configd` stores configuration or secret material.
- Only `execd` mutates Placement execution intent and general workload Kubernetes resources.
- Only `configd` writes Kubernetes Secret custody and projections, and it cannot write another
  resource kind.
- Only `edged` accepts external application traffic.
- Only `egressd` forwards CtlFlow-managed external HTTP.
- Only `auditd` stores authoritative kernel evidence.

## Failure posture

- Authentication, authorization, admission, secret access, and dependency resolution fail closed.
- Existing Kubernetes workloads continue under their last admitted generation while control
  reconciliation is unavailable.
- A required dependency that is not ready keeps its consumer unready; no substitute is selected.
- Provisioning failures remain explicit and retryable under the same idempotency identity.
- Outbox delivery is bounded and idempotent. Evidence-requiring mutation backpressures when its
  finite outbox bound is reached rather than dropping audit records.

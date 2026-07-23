---
title: Services
weight: 25
---

CtlFlow has ten kernel services. Each durable service owns its records, invariants, schema, and
status. `authd` is a stateless public protocol boundary, and `execd` additionally owns general
Kubernetes realization for CtlFlow workloads.

| Service | Authority |
| --- | --- |
| [`tenantd`](../tenantd/) | Tenants and Workspaces |
| [`authd`](../authd/) | Public authentication protocol mediation; no durable record authority |
| [`identityd`](../identityd/) | Accounts, groups, memberships, SSO, Sessions, invocation tokens, and delegated principals |
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

 browser -> authd -> tenantd / identityd
    |
    +-----> edged -> product or domain App -> owning service
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
 every process --------------> OpenTelemetry Collector
```

Arrows mean an API call or revisioned projection, not shared storage. A hot-path service may cache a
revisioned fact, but the cache is rebuildable and bounded by its owner's lifecycle contract.

## Service interactions

| Caller | Callee | Purpose |
| --- | --- | --- |
| `authd` | `tenantd` | Resolve the Tenant root, then an optional Workspace return segment |
| `authd` | `identityd` | Resolve login methods and begin, complete, or revoke one browser Session |
| `edged` | `identityd` | Exchange one established Session on an invocation-cache miss |
| Runtime proxy | `identityd` | Obtain a fresh invocation JWT for an admitted Run-originated Actor context |
| Internal invocation receiver | `identityd` | Refresh the bounded invocation verification-key cache |
| Owning service for product management | `policyd` | Authorize the exact operation after local workload and invocation validation |
| `tenantd` | `identityd` | Establish initial administrators and validate lifecycle references |
| `tenantd` | `configd` | Establish and retire Tenant and Workspace configuration scopes |
| `tenantd` | `execd` | Materialize, suspend, resume, and retire canonical Placements |
| `tenantd` | `pkgd` | Reconcile explicitly requested bootstrap Package installations |
| `identityd` | `tenantd` | Validate Tenant and Workspace scope and lifecycle |
| `identityd` | `pkgd`, `execd` | Validate App, Job, Placement, Run, and virtual-principal references |
| `identityd` | `egressd` | Perform admitted OIDC discovery and token exchange |
| `policyd` | `tenantd`, `identityd`, `pkgd`, `execd` | Resolve current scope, subject, Package ceiling, and Placement fence |
| `pkgd` | `tenantd`, `identityd` | Validate ownership scope, attached account, and target standing |
| `pkgd` | `configd` | Validate installation configuration readiness |
| `pkgd` | `execd` | Build Package artifacts and realize or retire App components |
| `configd` | `tenantd`, `identityd` | Validate configuration scope and user boundary |
| `configd` | `pkgd` | Resolve immutable Package and provider schemas |
| `configd` | `execd` | Validate target Placement and materialize its authorized Secret projection |
| `execd` | `tenantd`, `identityd`, `pkgd`, `configd`, `policyd` | Admit and realize Placement execution |
| `edged` | `tenantd`, `policyd`, `pkgd`, `execd` | Resolve Tenant then optional Workspace address, and authorize one external target after Session exchange |
| `egressd` | `configd`, `execd` | Resolve Placement binding and apply exact-purpose secret substitution |
| `auditd` | `tenantd`, `identityd`, `policyd` | Fence evidence queries and payload-removal authority |
| `auditd` | `configd` | Resolve retention and configured export-storage binding |
| `auditd` | `egressd` | Reach configured export storage when that binding requires external HTTP |
| Provider controller or App | `configd`, `egressd` | Submit claim-bound secret outputs and use admitted external HTTP |
| Every kernel service | `auditd` | Deliver idempotent evidence; durable mutations use a transactional outbox |

No service holds a database transaction while making one of these calls. A multi-service lifecycle
operation persists its local step, commits its audit outbox, and advances idempotently.

## Runtime paths

```text
 browser login -------------------------------> authd ----> identityd

 browser or external application client
             |
             v
           edged ---- Session cache miss ----> identityd
             |
             +---- authorization ------------> policyd
             |
             +---- exposure -----------------> pkgd
             |
             +---- endpoint -----------------> execd
             |
             v
       target runtime proxy ----> App

 App A ---- workload identity + optional invocation JWT -------> App B

 App or Run ---- workload identity + optional invocation JWT --> owning kernel service

 App or Run ---- process-bound proxy credential ----> egressd ----> approved origin
```

Internal App calls use Kubernetes Services directly. Each hop supplies its immediate Kubernetes
workload identity and propagates the current invocation JWT when preserving actor context. They do
not traverse `edged`.

## Ownership rules

- Only `tenantd` mutates Tenant or Workspace lifecycle.
- Only `authd` accepts public authentication protocol traffic; it owns no identity record.
- Only `identityd` establishes account, Session, invocation-token, virtual-principal, or runtime
  identity.
- Only `policyd` mutates grants or produces authoritative path-and-operation reviews.
- Only `pkgd` publishes Packages and mutates App installation intent.
- Only `configd` stores configuration or secret material.
- Only `execd` mutates Placement execution intent and general workload Kubernetes resources.
- Only `configd` writes Kubernetes Secret custody and projections, and it cannot write another
  resource kind.
- Only `edged` accepts general external application traffic.
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
- Telemetry export failure remains bounded and cannot fail domain work or satisfy an audit
  obligation.

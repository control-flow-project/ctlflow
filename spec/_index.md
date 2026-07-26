---
title: CtlFlow
weight: 1
---

CtlFlow is a multi-tenant substrate for installing and running applications and finite Jobs on
Kubernetes. A product built on CtlFlow supplies its distro, application domains, and tenant-facing
experience. CtlFlow supplies the tenant, identity, Package, configuration, Placement, execution,
policy, authentication, ingress, egress, audit, and telemetry foundations beneath that product.

Kubernetes is the only infrastructure, containment, and execution substrate. It is not the CtlFlow
domain model. Tenants, Workspaces, Placements, Packages, installations, Jobs, and Runs remain
CtlFlow records with one owning service each.

## Architecture

```text
 infrastructure operator
   -> ctlflow
   -> kubeconfig-authorized Kubernetes port-forward
   -> owning versioned gRPC contract

 product backend
   -> tenantd
      -> policyd
         -> identityd
      -> auditd

 CtlFlow realization ownership
   -> execd
   -> Kubernetes workloads, Services, volumes, and policy

 every process -> bounded OTLP -> OpenTelemetry Collector
```

The operator CLI asks the Kubernetes API server for an authorized port-forward, then calls the
owning service's private gRPC contract directly with the selected kubeconfig client certificate.
`authd` and `edged` are reserved public boundaries. Their ownership does not
imply a route; public routes exist only in checked versioned HTTP contracts.
Changing the client surface never changes record ownership or semantics.

`execd` is the sole CtlFlow owner of general Placement realization and workload execution. Other
services own domain intent and call `execd`. The only narrow Kubernetes write exception is
`configd`, which writes Secret custody and authorized projections without exposing their material
to `execd`.

## Kernel services

| Service | Owns |
| --- | --- |
| [`tenantd`](tenantd/) | Tenants and Workspaces |
| [`authd`](authd/) | Public authentication protocol mediation; no durable domain records |
| [`identityd`](identityd/) | Accounts, groups, memberships, external identity links, Sessions, virtual principals, and invocation identity |
| [`policyd`](policyd/) | Path-and-operation grants and authorization decisions |
| [`pkgd`](pkgd/) | Packages, artifacts, service contracts, exposures, and installations |
| [`configd`](configd/) | Configuration, secret custody, and provider configuration |
| [`execd`](execd/) | Placements, constraints, dependencies, workloads, Jobs, Runs, storage, endpoints, and Kubernetes realization |
| [`edged`](edged/) | External ingress and reverse proxying |
| [`egressd`](egressd/) | Controlled external HTTP |
| [`auditd`](auditd/) | Authoritative kernel evidence and exports |

Chat, Files, Tasks, Notifications, realtime delivery, application events, agent management, and
vertical business domains are Packages, not kernel services. An agent is a product composition of a
virtual principal, a Job, persistent state, and product-owned activation rules.

## Public surfaces

| Caller | Surface |
| --- | --- |
| Infrastructure operator | `ctlflow`, authenticated by a certificate-backed kubeconfig |
| Human signing in or out | Routes explicitly declared by `authd` |
| Tenant administrator or user | Product surface backed by approved owner operations |
| Browser, webhook, or external API client | Routes explicitly declared by `edged` |
| Application component or Run | Explicitly declared private bindings |
| Cluster operator | `kubectl` for Kubernetes implementation and diagnostics |

## Core laws

1. Every durable record has one owning service and one source of truth.
2. Kubernetes owns infrastructure, containment, scheduling, and process execution; CtlFlow owns
   domain intent and evidence.
3. Placement identifies where execution and state belong. It does not grant authority.
4. Placement constraints are owned and enforced by `execd`, not by a separate policy model.
5. Application authority is delegated from an existing account valid for the target Placement and
   can only be narrowed.
6. Every concrete runtime has a process-specific identity and cannot reuse another runtime's
   credentials or resource namespace.
7. Every internal hop authenticates its immediate Kubernetes workload. A short-lived invocation
   JWT carries User or Job context when the call acts on behalf of one.
8. Configuration and secrets are separate data classes even though `configd` owns both. Secret
   material has no general read operation.
9. Provider-specific dependency behavior belongs to installed Kubernetes controllers or service
   Packages, not a kernel service.
10. CtlFlow-managed external HTTP crosses `egressd`. Provider-specific protocols remain outside
    the kernel.
11. Application data and object authorization remain with the application that owns the object.
12. Every approved collection is bounded and paginated.
13. OpenTelemetry is the sole operational telemetry model. It is bounded and non-authoritative;
    required security and mutation evidence remains in `auditd`.

Continue with [Planes](planes/), [Model](model/), [Access](access/), [APIs](apis/),
[Contracts](contracts/), [Telemetry](telemetry/), [Flows](flows/), [Services](services/),
[Implementation](implementation/), and the [CLI](cli/).

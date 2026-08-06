---
title: CtlFlow
description: Kernel architecture, contracts, services, and implementation rules.
weight: 1
---

CtlFlow is a multi-tenant substrate for installing and running applications and finite Runs on
Kubernetes. A product built on CtlFlow supplies its distro, application domains, and tenant-facing
experience. CtlFlow supplies the tenant, identity, Package, configuration, Placement, execution,
policy, authentication, ingress, egress, audit, and telemetry foundations beneath that product.

Kubernetes is the only infrastructure, containment, and execution substrate. It is not the CtlFlow
domain model. Tenants, Workspaces, Placements, Packages, installations, Workloads, and Runs remain
CtlFlow records with one owning service each.

## Architecture

```text
 infrastructure operator
   -> ctlflow
   -> kubeconfig-authorized Kubernetes port-forward
   -> owning versioned gRPC contract

 product backend
   -> tenantd | pkgd | configd | execd
      -> identityd
      -> policyd
      -> auditd                 mutation only

 CtlFlow realization ownership
   -> execd
      -> pkgd                    exact App and Package reads
      -> configd                 exact consumer projections
   -> Kubernetes workloads, Services, volumes, and policy

 every process -> bounded OTLP -> OpenTelemetry Collector
```

The operator CLI asks the Kubernetes API server for an authorized port-forward, then calls the
owning service's private gRPC contract directly with the selected kubeconfig client certificate.
`authd` and `edged` are reserved public boundaries. Their ownership does not
imply a route; public routes exist only in checked versioned HTTP contracts.
Changing the client surface never changes record ownership or semantics.

`execd` is the sole CtlFlow owner of general Placement realization and workload execution. It reads
Pkgd-owned intent and asks Configd to realize exact consumer projections. The only narrow
Kubernetes write exception is `configd`, which writes Secret custody and authorized projections
without exposing their material to `execd`.

## Kernel services

| Service | Owns | Wire reference |
| --- | --- | --- |
| [`tenantd`](tenantd/) | Tenants and Workspaces | [12 gRPC methods](apis/tenantd/) |
| [`authd`](authd/) | Public authentication protocol mediation; no durable domain records | [3 HTTP routes](apis/authd/) |
| [`identityd`](identityd/) | Accounts, groups, memberships, external identity links, Sessions, virtual principals, and invocation identity | [7 gRPC methods](apis/identityd/) |
| [`policyd`](policyd/) | Path-and-operation grants and authorization decisions | [1 gRPC method](apis/policyd/) |
| [`pkgd`](pkgd/) | Immutable Package generations and installed App intent | [5 gRPC methods](apis/pkgd/) |
| [`configd`](configd/) | Scoped configuration, encrypted secret custody, and exact consumer projections | [5 gRPC methods](apis/configd/) |
| [`execd`](execd/) | Placements, constraints, dependencies, Workloads, Runs, storage, endpoints, and Kubernetes realization | [11 gRPC methods](apis/execd/) |
| [`edged`](edged/) | External ingress and reverse proxying | [7 HTTP methods](apis/edged/) |
| [`egressd`](egressd/) | Controlled external HTTP | [7 HTTP methods](apis/egressd/) |
| [`auditd`](auditd/) | Immutable authoritative kernel evidence | [1 gRPC method](apis/auditd/) |

Chat, Files, Tasks, Notifications, realtime delivery, application events, agent management, and
vertical business domains are Packages, not kernel services. An agent is a product composition of a
virtual principal, a finite Workload, persistent state, and product-owned activation rules.

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
   JWT carries User or Run context when the call acts on behalf of one.
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

## Reading order

1. [Planes](planes/) defines control-plane and data-plane boundaries.
2. [Model](model/) defines the records and their owners.
3. [Access](access/) defines caller, Actor, account, and Placement authority.
4. [API reference](apis/) shows every approved gRPC method and HTTP route.
5. [Contracts](contracts/) and [Flows](flows/) connect the services end to end.
6. [Services](services/) and each service page define detailed behavior.
7. [Implementation](implementation/) and [C#](csharp/) define repository and release rules.
8. [CLI](cli/) defines the operator surface.

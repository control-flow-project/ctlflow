---
title: CtlFlow
weight: 1
---

CtlFlow is a multi-tenant substrate for installing and running applications and finite Jobs on
Kubernetes. A product built on CtlFlow supplies its distro, application domains, and tenant-facing
experience. CtlFlow supplies the tenant, identity, Package, configuration, Placement, execution,
policy, ingress, egress, and audit foundations beneath that product.

Kubernetes is the only infrastructure, containment, and execution substrate. It is not the CtlFlow
domain model. Tenants, Workspaces, Placements, Packages, installations, Jobs, and Runs remain
CtlFlow records with one owning service each.

## Architecture

```text
 INFRASTRUCTURE OPERATOR                 TENANT USER OR ADMINISTRATOR

 ctlflow                                      product UI in browser
    |                                                |
    | kubeconfig                                     | tenant session
    v                                                v
 Kubernetes API server                            edged
    |                                                |
    | aggregated administrative APIs                 | authenticated request
    v                                                v
 CtlFlow owning services <---------------- product backend App
    |
    | desired Placement and execution state
    v
 execd
    |
    | Kubernetes API
    v
 namespaces, workloads, Services, policy, volumes, Secrets

 App and Job runtimes ---- direct authenticated calls ----> peer / kernel services / egressd
```

The operator CLI calls aggregated CtlFlow APIs through the Kubernetes API server. Tenant-facing
requests enter through `edged`; an authenticated product backend App calls the same owning-service
operations. Changing the client surface never changes record ownership or semantics.

`execd` is the sole CtlFlow owner of general Placement realization and workload execution. Other
services own domain intent and call `execd`. The only narrow Kubernetes write exception is
`configd`, which writes Secret custody and authorized projections without exposing their material
to `execd`.

## Kernel services

| Service | Owns |
| --- | --- |
| [`tenantd`](tenantd/) | Tenants and Workspaces |
| [`identityd`](identityd/) | Accounts, groups, memberships, SSO, sessions, virtual principals, and runtime identity |
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
| Infrastructure operator | `ctlflow`, authenticated by kubeconfig |
| Tenant administrator or user | Product-provided UI or API, authenticated by `identityd` |
| Browser or external API client | `edged` |
| Application component or Run | Direct authenticated service bindings and `egressd` |
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
7. Internal service connections are declared, resolved before startup, audience-bound, and
   authorized again by the receiving service.
8. Configuration and secrets are separate data classes even though `configd` owns both. Secret
   material has no general read operation.
9. Provider-specific dependency behavior belongs to installed Kubernetes controllers or service
   Packages. The kernel understands only a generic claim and binding contract.
10. CtlFlow-managed external HTTP crosses `egressd`. Provider-specific protocols remain outside
    the kernel.
11. Application data and object authorization remain with the application that owns the object.
12. Collections, logs, and evidence are bounded and paginated; bulk bytes use purpose-bound
    transfer paths.

Continue with [Planes](planes/), [Model](model/), [Access](access/), [APIs](apis/),
[Contracts](contracts/), [Flows](flows/), [Services](services/),
[Implementation](implementation/), and the [CLI](cli/).

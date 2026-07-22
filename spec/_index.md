---
title: CtlFlow
weight: 1
---

CtlFlow is a multi-tenant substrate for running applications and jobs on Kubernetes. Platforms
built on CtlFlow provide the tenant-facing product and user interface. CtlFlow provides the common
tenant, identity, package, execution, policy, egress, event, and audit foundations beneath them.

Kubernetes is the only execution backend in this specification, but it is not the product model.
CtlFlow APIs and the `ctlflow` CLI use CtlFlow terms; Kubernetes objects remain an implementation
surface for cluster operators.

## Architecture

```text
 infrastructure operator                 tenant administrator or user
            |                                        |
            | kubeconfig                             | platform session
            v                                        v
         ctlflow                               platform backend
            |                                        |
            +----------------+-----------------------+
                             |
                             v
                    Kubernetes API server
                             |
                             v
                  aggregated CtlFlow APIs
                             |
               +-------------+-------------+
               |                           |
               v                           v
        service-owned state        controller-manager
                                           |
                                           v
                                   Kubernetes resources

 workloads ------ direct runtime calls ------> CtlFlow runtime services
```

Administrative records are served through Kubernetes API aggregation and stored by their owning
CtlFlow service, never as CRDs or in Kubernetes etcd. Runtime traffic uses direct authenticated
service endpoints. `controller-manager` is the only CtlFlow component that writes Kubernetes
resources.

## Public surfaces

| Actor | Surface |
| --- | --- |
| Infrastructure operator | `ctlflow`, authenticated by kubeconfig |
| Tenant administrator or user | A platform-provided UI or API, authenticated by tenant identity |
| Application or job run | Direct runtime service APIs under its workload identity |
| Cluster operator | `kubectl` for Kubernetes implementation and diagnostics |

The CLI is an infrastructure-operator tool. Tenant users do not receive kubeconfig and do not use
it. A platform may expose any permitted subset of CtlFlow tenant operations through its own UI.

## Core laws

1. Every domain record has one owning service and one source of truth.
2. Tenant and application concepts are not encoded as Kubernetes API concepts.
3. Kubernetes owns infrastructure, containment, scheduling, and execution; CtlFlow does not
   reimplement them.
4. Administrative and runtime requests are authenticated at their respective boundaries and
   authorized again by the owning domain.
5. Context limits where state and execution live. It does not grant authority.
6. Application and job authority is delegated from an existing account and can only be narrowed.
7. Secret values, image bytes, artifacts, and unbounded logs do not enter domain records.
8. Collections are bounded and paginated. Bulk bytes move through purpose-bound transfer paths.
9. CtlFlow-owned Kubernetes objects are derived state. Direct edits never change domain truth.
10. External HTTP from Tenant workloads and CtlFlow components crosses `egressd`; domain services
    do not open independent external paths.

The specification is intentionally small. It defines stable concepts, ownership, boundaries, and
interactions. Operational tuning and provider-specific mechanics belong in implementation or
deployment documentation when they become necessary.

Continue with [Planes](planes/), [Model](model/), [Access](access/), [APIs](apis/),
[Services](services/), [Implementation](implementation/), and the [CLI](cli/).

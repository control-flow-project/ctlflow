---
title: Planes
weight: 5
---

CtlFlow separates domain intent, runtime mediation, and Kubernetes realization. This separation is
the primary ownership boundary in the system.

```text
 DOMAIN CONTROL              RUNTIME                     KUBERNETES

 tenants                     authentication              namespaces
 identities                  policy decisions            workloads
 packages                    event publication           scheduling
 apps and jobs               outbound HTTP               networking
 runs and evidence           evidence ingestion          volumes and Secrets
      |                           |                            ^
      | desired state             | direct calls               |
      +---------------------------+----------------------------+
                                  controller-manager
```

## Domain control

CtlFlow domain services own records such as tenants, users, packages, Apps, Jobs, Runs, grants,
egress policies, and audit evidence. Administrative clients reach these records through aggregated
Kubernetes APIs. Each service persists its own records and enforces its own invariants.

Domain state is not reconstructed from Kubernetes objects. Kubernetes names, labels, and status do
not become domain identity or authority.

## Runtime

Runtime services mediate actions performed by authenticated workloads or platform backends:

- authenticate a tenant user;
- evaluate an application-data permission;
- publish an application event;
- proxy an admitted outbound HTTP request; and
- ingest trusted audit evidence.

These calls use direct service endpoints because they may be frequent or streaming. They exercise
domain policy but do not create a second source of truth.

## Kubernetes realization

Kubernetes owns the mechanics below the domain model:

- cluster infrastructure;
- namespace and workload isolation;
- Pods, Deployments, StatefulSets, and Jobs;
- scheduling and process lifecycle;
- Services, routes, and network policy;
- persistent volumes; and
- native Secret custody.

`controller-manager` projects CtlFlow intent into these resources and reports observed state back
to the owning domain service. No other CtlFlow component writes them.

## Adjacent custody

Some material is referenced by CtlFlow but stored by an adjacent system:

| Material | Custody | CtlFlow stores |
| --- | --- | --- |
| Container image | OCI registry | Digest-pinned image reference |
| Secret value | Kubernetes Secret | Binding identity and readiness only |
| Artifact or export bytes | Configured object store | Bounded metadata and transfer state |
| Program logs | Configured log store | Query context, not the complete stream |

The boundary is strict: administrative APIs never become a transport for image, secret, artifact,
export, or unbounded log bytes.

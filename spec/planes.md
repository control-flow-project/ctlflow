---
title: Planes
weight: 5
---

CtlFlow separates domain control, trusted data-plane mediation, and Kubernetes realization. These
are ownership boundaries, not deployment marketing terms.

```text
 DOMAIN CONTROL                   DATA PLANE                   KUBERNETES

 tenants and workspaces           external ingress            namespaces
 identities and grants            internal service calls      workloads and scheduling
 Packages and installations       external HTTP egress        Services and networking
 configuration and secrets        trusted runtime context     volumes and Secrets
 Placements, Jobs, and Runs        audit ingestion             provider-owned resources
          |                              |                           ^
          | domain intent                | authenticated traffic     |
          +------------------------------+---------------------------+
                                         execd realization
```

## Domain control

The nine kernel services own CtlFlow records and their invariants. Operator clients use aggregated
Kubernetes APIs. Product backends use authenticated management operations over `edged`. Both
surfaces invoke the same service semantics and never create a second record owner.

Domain records are not reconstructed from Kubernetes objects. Native names, labels, and status are
derived realization details and never become CtlFlow identity or authority.

## Data plane

The data plane carries authenticated traffic:

- `edged` terminates the CtlFlow application boundary for browser and external API requests;
- runtime proxies validate audience-bound internal calls and deliver trusted actor context;
- applications call resolved peer dependencies directly through Kubernetes networking;
- `egressd` mediates admitted external HTTP; and
- all kernel services deliver attributable evidence to `auditd`.

An internal application call does not traverse `edged`. A browser session does not enter an
application. Each hop receives a new credential addressed to its exact target.

## Kubernetes realization

`execd` translates admitted CtlFlow intent into Kubernetes resources and observes their status. It
realizes:

- one namespace for each materialized Placement;
- long-running components as suitable continuous workload resources;
- finite executions as Jobs and periodic execution through Kubernetes scheduling;
- Services and explicitly admitted network paths;
- workload-scoped ServiceAccounts, runtime proxies, and process-specific credentials;
- PVCs and mounts for persistent files;
- references to Kubernetes Secret projections written only by `configd`; and
- provider-owned custom resources for configured external dependencies.

Kubernetes decides node placement, Pod scheduling, restart mechanics, and native object state.
`execd` remains responsible for CtlFlow admission, desired state, Run identity, and interpretation
of observed status. `configd` is the sole exception to its general realization ownership: it may
write only Secret custody and an authorized Secret projection in a Placement, then returns an
opaque binding that `execd` can reference.

## Adjacent custody

| Material | Custody | CtlFlow stores |
| --- | --- | --- |
| Container image | OCI registry | Digest-pinned image reference and provenance |
| Secret material | Kubernetes Secret under `configd` custody | Secret identity, policy, version, and readiness |
| Dependency implementation state | Installed provider controller or service Package | Generic claim, binding, generation, and readiness |
| Artifact or export bytes | Configured object dependency | Bounded metadata and transfer capability |
| Program logs | Configured log system | Query identity, cursor, and retention metadata |

Administrative APIs never transport image, secret, artifact, export, or unbounded log bytes.

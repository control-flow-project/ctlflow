---
title: execd
weight: 65
---

`execd` is the authority for Placement intent and the sole general
realization boundary between CtlFlow domain intent and Kubernetes workloads.

## Ownership

`execd` owns:

- canonical Placement identity and Placement constraints;
- desired workload, Job, Run, dependency, storage, and endpoint intent;
- the mapping from admitted intent to Kubernetes realization; and
- observed realization state needed by those records.

It does not own Tenants, Users, Packages, configuration, secrets, policy,
application data, or Kubernetes itself.

## Contract

Only methods declared in the service-owned versioned protobuf contract exist.
This page does not imply create-or-get Placement, start, stop, wait, watch,
drain, reconcile, endpoint, Job, Run, log, or dependency methods.

The contract must remain semantic. Callers describe CtlFlow intent; they do not
select Deployment, StatefulSet, Job, Pod, namespace, controller, node, or
provider-specific Kubernetes objects.

## Kubernetes boundary

```text
owning service intent -> execd -> Kubernetes API
```

`execd` may realize an admitted long-running component, stateful component, or
finite execution using the appropriate Kubernetes primitive. That choice is
implementation detail and is never a second caller-visible path.

CtlFlow Placements are domain records. Kubernetes namespaces are derived
realization boundaries and cannot replace Placement identity or policy.
Provider-owned custom resources may be used by installed provider
controllers; they are not `execd` domain records.

## Invariants

- One valid Placement source tuple maps to one canonical Placement.
- Every workload and finite execution belongs to one Placement.
- Constraints only narrow inherited choices.
- Runtime identity and dependency bindings are process-specific and cannot be
  reused across consumers.
- `execd` does not expose Kubernetes credentials to application code.
- No dependency RPC occurs while holding a persistence transaction.
- A mutation requires an explicit versioned operation and direct audit through
  the approved audit contract.

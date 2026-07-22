---
title: controller-manager
weight: 75
---

`controller-manager` realizes CtlFlow domain intent as Kubernetes resources. It is the only CtlFlow
component that writes Kubernetes and is never a domain authority.

## Reconciliation

```text
 tenantd -------- desired Context containment ----+
 execd ---------- desired App/Run execution -------+--> controller-manager
 egressd -------- desired runtime bindings --------+
                                                       |
                                                       v
                                                   Kubernetes
                                                       |
                                                       v
                                      observed status returned to owner
```

The manager stores no independent domain records. Reconciliation bookkeeping in Kubernetes is
rebuildable from desired state and observed cluster state.

## Realization

- Each active Context becomes one opaque namespace with the required isolation and resource
  policy.
- Continuous replaceable App components become Deployments.
- Continuous components requiring stable identity become StatefulSets.
- App lifecycle work and Runs become Kubernetes Jobs.
- Package-declared persistent data becomes PVC bindings.
- Run input and output contracts become scoped volumes plus platform transfer helpers that stream
  through `egressd` and report verified metadata to `execd`.
- Each concrete execution receives a dedicated ServiceAccount and runtime identity.
- Declared ports and exposure become native Services and routes.
- Admitted service connections become explicit network paths with a projected credential whose
  audience identifies the destination App component.
- Admitted egress connections become explicit paths to `egressd`.
- Write-only domain secret bindings become opaque Kubernetes Secrets.
- App and Run output is connected to the installation product-log collection path.

The manager chooses native names from opaque realization IDs. Domain display names and ownership
graphs are not encoded into Kubernetes identity.

## Protocol

The manager watches desired state from the owning services, reconciles idempotently, and writes
observed generation, lifecycle, and bounded diagnostics back through owner status operations. A
retry never creates a second domain path. Invalid desired state becomes an explicit condition.

Credential material is accepted only from the owning service after its write-only domain operation
has authorized and validated the binding. The manager writes the Secret and returns readiness; it
never makes the value readable through CtlFlow.

## Boundaries and invariants

- The manager cannot create, approve, or authorize a domain record.
- Deleting a Kubernetes object is realization cleanup, not domain deletion.
- Manual edits to managed objects are drift and may be reconciled away.
- Unchanged desired state produces no semantic Kubernetes change.
- Observed Kubernetes status never becomes a second source of domain truth.
- Native objects without a valid opaque ownership record are never adopted automatically.

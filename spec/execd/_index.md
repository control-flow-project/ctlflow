---
title: execd
weight: 50
---

`execd` owns installed applications and finite work from configuration through observed execution.

## Owns

| Record | Meaning |
| --- | --- |
| App | One App Package installed in one Context |
| Job | Reusable finite-work definition with a virtual principal |
| Trigger | One event or schedule activation belonging to a Job |
| Run | One invocation of a Job |

It serves `exec.ctlflow.com/v1alpha1` as `apps`, `jobs`, `jobtriggers`, and `runs`. Logs, artifacts,
cancellation, and write-only slot binding are subresources of their owning record.

## Responsibilities

- Validate Package, Context, attached account, quota, and package-declared bindings when creating
  or changing an App or Job.
- Manage App install, configuration, upgrade, suspension, and removal.
- Allocate App-component and Job virtual principals and expose their package capability ceilings.
- Manage Job enablement and many independent Triggers.
- Evaluate schedule Triggers and accept idempotent Event-trigger activation from `eventd`.
- Create Runs in their Job's Context and track lifecycle, attempts, cancellation, logs, and bounded
  artifact metadata.
- Produce desired execution for `controller-manager` and accept observed status.
- Obtain short-lived artifact transfers from `egressd` without handling bulk bytes.
- Serve bounded product-log queries from the installation log store using stable execution
  identity; `controller-manager` configures collection as part of realization.

Apps and Jobs always instantiate immutable catalog Packages; they never name an image directly.
Package-declared configuration, secret slots, persistent-data slots, and service connections are
bound on the App or Job. Secret values use write-only operations and are never stored in `execd`.
An update is rejected when the target Package would orphan a binding, Trigger, or referenced
App-component principal.

## Activation

A Run may be created manually, through a platform API, by a schedule Trigger, or by an Event
Trigger. Manual invocation is not itself a Trigger. A Job may have any number of Triggers.

Schedule evaluation belongs to `execd`; Kubernetes receives an ordinary Job only after a Run
exists. Event delivery is retryable, while `execd` creates at most one Run for the same Event and
Trigger.

```text
 manual/API --------+
 schedule Trigger --+--> Run --> desired execution --> controller-manager
 Event Trigger -----+
```

## Boundaries

`execd` decides that execution should exist and describes its requirements. Kubernetes decides
where and how the workload runs. `execd` never writes Kubernetes resources.

`identityd` owns attached accounts, `catalogd` owns Package contracts, `tenantd` owns Contexts,
`policyd` owns grants and authorization decisions, and `eventd` owns accepted Events and delivery
evidence.

## Invariants

- Every App has exactly one immutable Context and attached account.
- Every Job has one immutable Context and attached account.
- Every Run inherits its Job's Context.
- Every App component and Job has a stable virtual principal; each concrete execution has a
  separate runtime identity.
- A disabled or suspended record admits no new execution.
- A disabled attached account stops App realization and new Runs while preserving desired state;
  active Runs fail with reason `account_disabled`.
- A revoked Package admits no new execution; Apps and Jobs using it stop, and affected Runs fail
  with reason `package_revoked`.
- Terminal Runs are immutable evidence.
- Event redelivery cannot create a duplicate Run for an Event/Trigger pair.

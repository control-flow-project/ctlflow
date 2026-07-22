---
title: Services
weight: 25
---

CtlFlow consists of eight domain services and one Kubernetes reconciler. A service owns one domain
concern and its durable records. Kubernetes retains infrastructure and workload mechanics.

| Component | Owns |
| --- | --- |
| [`tenantd`](../tenantd/) | Tenants, Workspaces, Contexts, and quota policy |
| [`catalogd`](../catalogd/) | Immutable Packages, resource profiles, and declared application vocabulary |
| [`execd`](../execd/) | Apps, Jobs, Triggers, Runs, and desired execution |
| [`identityd`](../identityd/) | Users, Memberships, identity links, SSO, and sessions |
| [`eventd`](../eventd/) | Application Events and delivery evidence |
| [`policyd`](../policyd/) | Application-data grants and authorization decisions |
| [`egressd`](../egressd/) | External HTTP destinations, access policy, rewriting, and credential mediation |
| [`auditd`](../auditd/) | Security and activity evidence and exports |
| [`controller-manager`](../controller-manager/) | Projection of domain intent into Kubernetes |

## Request paths

```text
 ADMINISTRATIVE

 ctlflow or platform backend
             |
             v
      kube-apiserver
       |  |  |  |  |  |  |  |
       v  v  v  v  v  v  v  v
      domain services and their stores

 RUNTIME

 platform backend ----------> identityd
 App component or Run ------> eventd / egressd
 protected App service -----> policyd
 CtlFlow components --------> auditd

 REALIZATION

 tenantd + execd + egressd desired state
                     |
                     v
             controller-manager
                     |
                     v
                 Kubernetes
```

## Service dependencies

Cross-service references are resolved through the owning service's API. A service may keep a
revisioned projection for a hot path, but the projection is rebuildable and never becomes another
authority.

| Service | Reads or invokes | Reason |
| --- | --- | --- |
| `tenantd` | `identityd` | Validate Users and Memberships used by derived Contexts |
| `catalogd` | none | Catalog publication is infrastructure-owned and self-contained |
| `execd` | `tenantd`, `catalogd`, `identityd` | Validate Context, Package, quota, and attached account; observe Package revocation |
| `execd` | `catalogd` | Report convergence after a revoked Package's executions stop |
| `execd` | `egressd` | Obtain bounded artifact transfers |
| `identityd` | `tenantd`, `execd` | Validate scope references and an App audience requested during credential exchange |
| `identityd` | `egressd` | Perform OIDC discovery and token exchange through the provider's approved destination |
| `eventd` | `catalogd`, `tenantd`, `execd` | Validate declarations and Context, then activate matching Triggers |
| `policyd` | `catalogd`, `tenantd`, `identityd`, `execd` | Intersect declared operations, Context, account, and workload authority |
| `egressd` | `tenantd`, `identityd`, `execd` | Resolve the authenticated workload's domain identity and Context |
| `auditd` | `tenantd`, `egressd` | Apply Tenant retention bounds and produce transfer access for completed exports |
| `controller-manager` | `tenantd`, `execd`, `egressd` | Reconcile containment, workloads, and admitted runtime bindings |
| `identityd`, `execd`, `egressd` | `controller-manager` | Bind validated write-only secret material into Kubernetes custody |
| Every durable service and `controller-manager` | `auditd` | Deliver attributable security and activity evidence |
| Every owner of Tenant records | `tenantd` | Report quota usage and acknowledge coordinated Tenant deletion |

Every durable service commits audit evidence to a transactional outbox with its domain mutation.
Outbox delivery to `auditd` is idempotent and asynchronous. A domain transaction never holds its
database transaction while waiting for another service.

Only the owner may mutate a record. For example, `eventd` may request trigger activation, but
`execd` validates and creates the Run. No component reads or writes another service's database.

## Failure posture

- Authorization and admission fail closed when required current authority cannot be established.
- A control-plane outage does not invent alternative state or silently widen access.
- Existing Kubernetes workloads continue according to their last realized desired state while
  reconciliation is unavailable.
- Event delivery and audit outboxes retry idempotently and remain bounded.
- Dependency failure is surfaced as an explicit unavailable or pending condition, not a successful
  partial mutation.

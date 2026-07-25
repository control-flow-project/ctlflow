---
title: Services
weight: 25
---

CtlFlow has ten kernel services. Each durable service owns its records, invariants, schema, and
status. `authd` is a stateless public protocol boundary, and `execd` additionally owns general
Kubernetes realization for CtlFlow workloads.

| Service | Authority |
| --- | --- |
| [`tenantd`](../tenantd/) | Tenants and Workspaces |
| [`authd`](../authd/) | Public authentication protocol mediation; no durable record authority |
| [`identityd`](../identityd/) | Accounts, groups, memberships, SSO, Sessions, invocation tokens, and delegated principals |
| [`policyd`](../policyd/) | Roles, grants, and path-and-operation decisions |
| [`pkgd`](../pkgd/) | Packages, artifacts, service contracts, exposures, and Apps |
| [`configd`](../configd/) | Configuration, secrets, and provider configuration |
| [`execd`](../execd/) | Placements, constraints, workloads, dependencies, Jobs, Runs, endpoints, and realization |
| [`edged`](../edged/) | External ingress mediation and bounded derived caches; no route authority |
| [`egressd`](../egressd/) | External HTTP destinations, policy, and mediation |
| [`auditd`](../auditd/) | Kernel audit evidence and exports |

Application domains remain outside this list. A distro installs Chat, Files, Tasks, Notifications,
realtime, event delivery, agent management, and its vertical applications as Packages.

## Primary paths

```text
 operator -> Kubernetes API -> owning service

 browser -> authd -> tenantd / identityd
    |
    +-----> edged -> product or domain App -> owning service
                |              |
                +-> identityd  +-> identityd / policyd
                +-> policyd
                +-> pkgd
                +-> execd

 identityd / configd / execd / pkgd -> tenantd lifecycle work
 pkgd -----------------------------> identityd / configd / execd
 execd ---> tenantd / identityd / pkgd / configd / policyd -> Kubernetes

 App or Run -> runtime proxy -> bound App
 App or Run -----------------> egressd -> approved external HTTP

 every other kernel service -> auditd
 every process --------------> OpenTelemetry Collector
```

Arrows mean an API call or revisioned projection, not shared storage. A hot-path service may cache a
revisioned fact, but the cache is rebuildable and bounded by its owner's lifecycle contract.

## Service interactions

| Caller | Callee operations | Purpose |
| --- | --- | --- |
| `authd` | `tenantd.ResolveTenant`, `ResolveWorkspace` | Resolve Tenant login root and optional Workspace return |
| `authd` | `identityd.ResolveLoginOptions`, `BeginLogin`, `CompleteLogin`, `RevokeSession` | Mediate one public browser authentication transaction |
| `edged` | `tenantd.ResolveTenant`, `ResolveWorkspace` | Resolve the external hierarchy |
| `edged` | `pkgd.ResolveExposure`, `AuthorizeArtifactTransfer` | Resolve one route declaration or immutable UI artifact |
| `edged` | `identityd.ExchangeSession` | Exchange one Session on an invocation-cache miss |
| `edged` | `policyd.CheckAccess` | Authorize the declared coarse exposure operation |
| `edged` | `execd.ResolveEndpoint`, `StartAppOnDemand` | Resolve only the exact App target |
| Runtime proxy | `identityd.IssueRunInvocation`, `MintRuntimePrincipal`, `RetireRuntimePrincipal`, `IssueProxyCredential` | Establish process and delegated execution identity |
| Internal invocation receiver | `identityd.GetInvocationVerificationKeys` | Refresh one bounded verification-key cache |
| Owning kernel/App service | `policyd.CheckAccess`, `ExplainAccess` | Authorize an exact owned operation and path |
| `identityd`, `configd`, `execd`, `pkgd` | `tenantd.ListLifecycleSteps`, `WatchLifecycleSteps`, `AcknowledgeLifecycleStep` | Reconcile only lifecycle work assigned to the authenticated owner |
| `identityd` | `tenantd.GetLifecycle` | Validate Tenant/Workspace standing |
| `identityd` | `pkgd.ResolveAppGeneration`; `execd.ResolvePlacement`, `ResolveRuntimeContext` | Validate owner, Placement, Run, runtime, and dependency references |
| `identityd` | `egressd.ForwardHttp` | Perform admitted SSO provider HTTP |
| `policyd` | `tenantd.GetLifecycle`; `identityd.ResolvePrincipal`, `ListPrincipalGroups`; `pkgd.ResolveOperationCeiling`; `execd.ResolveRuntimeContext` | Establish every current decision layer |
| `pkgd` | `tenantd.GetLifecycle`; `identityd.ValidateAttachedAccount`, `CreateVirtualPrincipal`, `DisableVirtualPrincipal`, `EnableVirtualPrincipal`, `RetireVirtualPrincipal` | Validate ownership and delegated App identity |
| `pkgd` | `configd.ValidateConfiguration`, `ResolveConfiguration`, `ResolveProviderSelection` | Validate App generation input |
| `pkgd` | `execd.ReconcileAppGeneration`, `DrainAppGeneration`, `CreateRun` | Build and realize or retire App components |
| `configd` | `tenantd.GetLifecycle`; `identityd.ResolvePrincipal`; `pkgd.ResolveConfigurationSchema`, `ResolveProviderContract`; `execd.ResolvePlacement`, `ResolveRuntimeContext` | Validate scope, declaration, consumer, and target |
| `execd` | `tenantd.GetLifecycle`; `identityd.ValidateAttachedAccount`, `CreateVirtualPrincipal`, `DisableVirtualPrincipal`, `EnableVirtualPrincipal`, `RetireVirtualPrincipal`, `RetireRuntimePrincipal`; `pkgd.ResolvePackage`, `ResolveAppGeneration`, `ResolveProviderContract`, `ResolveServiceContract`; `configd.ResolveConfiguration`, `ResolveProviderSelection`, `MaterializeWorkloadSecret`; `policyd.CheckAccess` | Admit and realize Placement execution |
| `egressd` | `tenantd.GetLifecycle`; `identityd.GetInvocationVerificationKeys`; `execd.ResolveRuntimeContext`; `configd.ReleaseEgressSecret` | Establish exact outbound binding and authentication |
| `auditd` | `tenantd.GetLifecycle`; `identityd.ResolvePrincipal`; `policyd.CheckAccess`; `configd.ResolveConfiguration`; `egressd.ForwardHttp` | Fence evidence access, retention, and export storage |
| Provider controller or App | `configd.SubmitDependencySecret`; `egressd.ForwardHttp` | Submit claim-bound output and use admitted external HTTP |
| Every kernel service except `auditd` | `auditd.RecordAuditBatch` | Deliver idempotent evidence; durable mutations use a transactional outbox |

No service holds a database transaction while making one of these calls. A multi-service lifecycle
operation persists its local step, commits its audit outbox, and advances idempotently.

## Runtime paths

```text
 browser login -------------------------------> authd ----> identityd

 browser or external application client
             |
             v
           edged ---- Session cache miss ----> identityd
             |
             +---- authorization ------------> policyd
             |
             +---- exposure -----------------> pkgd
             |
             +---- endpoint -----------------> execd
             |
             v
       target runtime proxy ----> App

 App A ---- workload identity + optional invocation JWT -------> App B

 App or Run ---- workload identity + optional invocation JWT --> owning kernel service

 App or Run ---- process-bound proxy credential ----> egressd ----> approved origin
```

Internal App calls use Kubernetes Services directly. Each hop supplies its immediate Kubernetes
workload identity and propagates the current invocation JWT when preserving actor context. They do
not traverse `edged`.

## Ownership rules

- Only `tenantd` mutates Tenant or Workspace lifecycle.
- Only `authd` accepts public authentication protocol traffic; it owns no identity record.
- Only `identityd` establishes account, Session, invocation-token, virtual-principal, or runtime
  identity.
- Only `policyd` mutates grants or produces authoritative path-and-operation reviews.
- Only `pkgd` publishes Packages and mutates App installation intent.
- Only `configd` stores configuration or secret material.
- Only `execd` mutates Placement execution intent and general workload Kubernetes resources.
- Only `configd` writes Kubernetes Secret custody and projections, and it cannot write another
  resource kind.
- Only `edged` accepts general external application traffic.
- Only `egressd` forwards CtlFlow-managed external HTTP.
- Only `auditd` stores authoritative kernel evidence.

## Failure posture

- Authentication, authorization, admission, secret access, and dependency resolution fail closed.
- Existing Kubernetes workloads continue under their last admitted generation while control
  reconciliation is unavailable.
- A required dependency that is not ready keeps its consumer unready; no substitute is selected.
- Provisioning failures remain explicit and retryable under the same idempotency identity.
- Outbox delivery is bounded and idempotent. Evidence-requiring mutation backpressures when its
  finite outbox bound is reached rather than dropping audit records.
- Telemetry export failure remains bounded and cannot fail domain work or satisfy an audit
  obligation.

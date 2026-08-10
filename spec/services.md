---
title: Services
description: Kernel service inventory, responsibilities, dependencies, and exclusions.
weight: 25
---

CtlFlow has ten kernel ownership boundaries.

| Service | Authority | API |
| --- | --- | --- |
| [`tenantd`](../tenantd/) | Tenants and Workspaces | [gRPC](../apis/tenantd/) |
| [`authd`](../authd/) | Public authentication protocol; no durable records | [HTTP](../apis/authd/) |
| [`identityd`](../identityd/) | Accounts, standing, Groups, login identity, Sessions, and invocation identity | [gRPC](../apis/identityd/) |
| [`policyd`](../policyd/) | Roles, grants, the fixed kernel operation catalog, and access decisions | [gRPC](../apis/policyd/) |
| [`pkgd`](../pkgd/) | Packages and installed application intent | [gRPC](../apis/pkgd/) |
| [`configd`](../configd/) | Scoped configuration, encrypted secret custody, and exact consumer projections | [gRPC](../apis/configd/) |
| [`execd`](../execd/) | Placements and Kubernetes realization intent | [gRPC](../apis/execd/) |
| [`edged`](../edged/) | Public application reverse proxy; no route authority | [HTTP](../apis/edged/) |
| [`egressd`](../egressd/) | Controlled external HTTP | [HTTP](../apis/egressd/) |
| [`auditd`](../auditd/) | Required kernel audit evidence | [gRPC](../apis/auditd/) |

Application domains remain outside this list. Chat, Files, Tasks,
Notifications, realtime delivery, agent management, and vertical business
records belong to installed Packages.

## Contract law

An ownership boundary does not imply an API. A callable operation exists only
when it appears in the owner's checked versioned protobuf or public HTTP
contract and has matching normative behavior and canonical evidence.

The approved private call graph is:

```text
admitted product workload
  +-> identityd.GetInvocationVerificationKeys
  +-> admitted identityd administration operations
  +-> policyd.CheckAccess

tenantd
  +-> identityd.GetInvocationVerificationKeys
  +-> policyd.CheckAccess
  +-> auditd.RecordAuditBatch

policyd
  +-> identityd.GetInvocationVerificationKeys
  +-> identityd.ResolvePrincipal
  +-> identityd.ListPrincipalGroups
  +-> execd.ResolveWorkloadOperationBinding   product operations only

authd
  +-> identityd.GetLoginProvider
  +-> identityd.ListWorkspaceLoginProviderAdmissions
  +-> identityd.CreateSession
  +-> identityd.RevokeSession
  +-> purpose-bound egressd HTTP binding

edged
  +-> identityd.ExchangeSession

execd
  +-> identityd.GetInvocationVerificationKeys
  +-> policyd.CheckAccess
  +-> pkgd.GetApp
  +-> pkgd.GetPackage
  +-> configd.ApplyProjection
  +-> identityd.IssueRunInvocation
  +-> auditd.RecordAuditBatch

egressd
  +-> no kernel RPC; consumes process-private projected binding material

identityd
  +-> policyd.CheckAccess                  administration operations only
  +-> auditd.RecordAuditBatch

pkgd
  +-> identityd.GetInvocationVerificationKeys
  +-> policyd.CheckAccess
  +-> auditd.RecordAuditBatch

configd
  +-> identityd.GetInvocationVerificationKeys
  +-> policyd.CheckAccess
  +-> auditd.RecordAuditBatch

configured provisioner controller
  +-> configd.PublishConfiguration(dependency_claim_id, dependency_claim_revision)
  +-> configd.PublishSecret(dependency_claim_id, dependency_claim_revision)
```

No other cross-service method is implied by the architecture diagrams,
ownership table, CLI naming, or an implementation helper.

Execd realizes Edged sidecars and may realize or select Egressd binding
workloads through Kubernetes. Deployment and process-private projection are
not service-to-service RPCs and do not make either proxy an Execd record.

## Ownership rules

- Only `tenantd` mutates Tenant or Workspace state.
- Only `identityd` owns account, standing, login-provider registration,
  Workspace provider admission, Session, and delegated-principal facts or
  signs invocation JWTs.
- Only `policyd` owns Roles, grants, and authoritative access decisions. Kernel
  operation ownership is Policyd's checked deployment catalog; product operation
  ownership is declared by `pkgd`, admitted by `execd`, and resolved by
  `policyd` at decision time.
- `execd.ResolveWorkloadOperationBinding` admits only `policyd` and never calls
  `policyd`, so authorization cannot recurse.
- Only `pkgd` owns Package and App installation intent.
- Only `configd` owns configuration and secret material.
- Only `execd` owns Placement and general workload realization intent.
- Only `edged` accepts general external application traffic.
- Only `egressd` performs CtlFlow-managed external HTTP.
- Only `auditd` stores authoritative kernel evidence.
- `authd` is the only public authentication-protocol boundary.

No service reads or writes another service's database. A dependency call is
made over its production transport without holding a persistence transaction.

## Identity and failure

Every private call authenticates its immediate Kubernetes workload. Calls
acting on behalf of a User or virtual principal additionally carry one
short-lived invocation JWT. Each receiver validates its own admission and
target fence.

Authentication, authorization, persistence, and required dependency failures
fail closed. Telemetry export remains bounded and cannot satisfy an audit
obligation.

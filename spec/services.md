---
title: Services
weight: 25
---

CtlFlow has ten kernel ownership boundaries.

| Service | Authority |
| --- | --- |
| [`tenantd`](../tenantd/) | Tenants and Workspaces |
| [`authd`](../authd/) | Public authentication protocol; no durable records |
| [`identityd`](../identityd/) | Accounts, standing, Groups, Sessions, and delegated identity |
| [`policyd`](../policyd/) | Roles, grants, operation ownership, and access decisions |
| [`pkgd`](../pkgd/) | Packages and installed application intent |
| [`configd`](../configd/) | Configuration and secret custody |
| [`execd`](../execd/) | Placements and Kubernetes realization intent |
| [`edged`](../edged/) | Public application reverse proxy; no route authority |
| [`egressd`](../egressd/) | Controlled external HTTP |
| [`auditd`](../auditd/) | Required kernel audit evidence |

Application domains remain outside this list. Chat, Files, Tasks,
Notifications, realtime delivery, agent management, and vertical business
records belong to installed Packages.

## Contract law

An ownership boundary does not imply an API. A callable operation exists only
when it appears in the owner's checked versioned protobuf or public HTTP
contract and has matching normative behavior and canonical evidence.

The approved private call graph is:

```text
tenantd
  +-> identityd.GetInvocationVerificationKeys
  +-> policyd.CheckAccess
  +-> auditd.RecordAuditBatch

policyd
  +-> identityd.GetInvocationVerificationKeys
  +-> identityd.ResolvePrincipal
  +-> identityd.ListPrincipalGroups
```

No other cross-service method is implied by the architecture diagrams,
ownership table, CLI naming, or an implementation helper.

## Ownership rules

- Only `tenantd` mutates Tenant or Workspace state.
- Only `identityd` owns account, standing, Session, and delegated-principal
  facts.
- Only `policyd` owns Roles, grants, operation ownership, and authoritative
  access decisions.
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

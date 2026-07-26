---
title: Contracts
weight: 22
---

This page defines the approved connections between kernel services. Ownership
pages do not create additional calls.

## Private transport

Every private gRPC call carries:

```text
authorization: Bearer <bound Kubernetes workload token>
ctlflow-invocation: Bearer <invocation JWT>   when acting on behalf of an Actor
traceparent: <W3C trace context>
tracestate: <W3C vendor state>                optional
```

The workload token establishes the immediate caller. The invocation JWT
establishes subject account, Actor, Tenant, optional Workspace, and origin
facts. Each receiver validates both independently and ignores caller-supplied
fields that attempt to replace them.

Every call has a finite deadline, propagates cancellation, and uses private
TLS. A caller never holds a database transaction while making a dependency
call.

## Tenant capability authorization

A product backend calls an approved capability-enabled Tenantd operation with
its own workload token and the unchanged invocation JWT.

```text
product backend
  -> tenantd
       -> policyd.CheckAccess
            -> identityd.GetInvocationVerificationKeys
            -> identityd.ResolvePrincipal
            -> identityd.ListPrincipalGroups
       -> tenantd Domain operation
       -> auditd.RecordAuditBatch   mutation only
```

Tenantd:

1. authenticates the exact admitted backend;
2. validates the invocation JWT;
3. applies the Tenant and Workspace fence;
4. constructs the operation and resource path from validated domain IDs;
5. calls `CheckAccess` as `SERVICE/svc_tenantd`; and
6. applies an allow only to the current call.

Policyd authenticates Tenantd, verifies that Tenantd owns the operation,
validates the same invocation independently, and obtains current principal,
attached-account, standing, and direct-Group facts from Identityd.

A human or service Actor needs one matching direct or direct-Group allow. A
virtual Actor additionally requires the same authority for its immutable
attached account. No-match is deny. Missing current standing is `NOT_FOUND`.
Identity or policy dependency failure is `UNAVAILABLE`.

Operator-only and autonomous-kernel Tenantd operations remain separate
admission paths and do not manufacture a capability Actor.

## Tenant and Workspace resolution

`ResolveTenant` receives one Tenant address and returns canonical Tenant ID,
state, and revision only for an active Tenant.

`ResolveWorkspace` receives canonical parent Tenant ID and one Workspace
address. It returns canonical Workspace ID, state, and revision only when both
Workspace and parent Tenant are active.

The external hierarchy is:

```text
/tenants/<tenant-address>
/tenants/<tenant-address>/workspaces/<workspace-address>
```

Infrastructure owns the external authority. Tenantd owns the two address
segments and parent relationship. A caller may cache a bounded projection, but
Tenantd owns no cache controls, binding generation, route, or cursor state.

## Invocation verification

Tenantd and Policyd load public invocation keys with
`identityd.GetInvocationVerificationKeys`. They cache the exact bounded key set
only until its supplied expiry and refresh on expiry or an unknown key ID.

Policyd uses `ResolvePrincipal` and all pages of `ListPrincipalGroups` at the
exact target. These operations return identity facts only. They never return a
Role, grant, operation, resource path, or decision.

## Audit delivery

After an audited mutation commits and no transaction is held, the source calls
`auditd.RecordAuditBatch` directly.

```text
Domain outcome -> source service -> auditd
```

The source event identity makes an identical replay idempotent and a
conflicting replay invalid. The source stores no audit outbox, queue, journal,
cursor, delivery worker, or fallback copy.

Reads, rejected calls, create retries, and no-op mutations emit no successful
Tenantd mutation event.

## Complete call inventory

| Caller | Callee | Purpose |
| --- | --- | --- |
| `tenantd` | `identityd.GetInvocationVerificationKeys` | Validate invocation JWTs |
| `tenantd` | `policyd.CheckAccess` | Authorize one Tenantd capability |
| `tenantd` | `auditd.RecordAuditBatch` | Record one committed Tenant or Workspace mutation |
| `policyd` | `identityd.GetInvocationVerificationKeys` | Independently validate the invocation |
| `policyd` | `identityd.ResolvePrincipal` | Obtain current exact-target identity and standing facts |
| `policyd` | `identityd.ListPrincipalGroups` | Obtain bounded pages of direct Group IDs |

No other kernel-to-kernel call is approved by this specification.

---
title: Contracts
weight: 22
---

This page defines the approved connections between kernel services. Ownership
pages do not create additional calls.

## Private transport

Every private gRPC call carries one operation-approved immediate workload
identity:

```text
authorization: Bearer <bound Kubernetes workload token>   ordinary kernel call
OR mutual-TLS Authd client certificate                    Authd Session call only
ctlflow-invocation: Bearer <invocation JWT>   when acting on behalf of an Actor
traceparent: <W3C trace context>
tracestate: <W3C vendor state>                optional
```

The bound workload token establishes the immediate caller for ordinary kernel
calls. Exactly `identityd.CreateSession` and `identityd.RevokeSession` instead
authenticate Authd through its process-private mutual-TLS client certificate,
mapped to `SERVICE/svc_authd`; those calls carry no workload bearer. The
invocation JWT establishes subject account, Actor, Tenant, optional Workspace,
and origin facts where its operation permits one. Each receiver validates the
applicable identities independently and ignores caller-supplied fields that
attempt to replace them.

Every call has a finite deadline, propagates cancellation, and uses private
TLS. Authd's two calls require mutual TLS and exact peer validation. A caller
never holds a database transaction while making a dependency call.

`identityd.GetInvocationVerificationKeys` is a bootstrap operation: it carries
workload authentication and trace context but no invocation JWT.
Receivers use its result to validate an invocation whose key is not in their
current cache. Identityd fact operations still receive and independently
validate the unchanged invocation.

Identityd Session and issuance operations also omit an existing invocation.
They establish identity from an exact admitted workload plus either a
validated external identity, opaque Session credential, or Execd-owned Run
request as defined by their individual contracts. Authd's two Session
operations use the mutual-TLS workload identity; the other issuance operations
use their declared workload bearer.

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

Identityd independently validates the unchanged invocation JWT on both fact
operations. `ResolvePrincipal` admits only the invocation Actor.
`ListPrincipalGroups` admits that Actor and, for a virtual invocation, its
immutable attached subject account. Identityd re-establishes current
attachment, target standing, and both invocation and virtual-principal fences
on every page.

## Session and invocation issuance

```text
validated provider result
  -> authd
       -> identityd.CreateSession   Authd workload mTLS
            -> auditd.RecordAuditBatch
       <- one-time opaque Session credential

browser cookie
  -> edged
       -> identityd.ExchangeSession
       <- short-lived Session-origin invocation JWT

admitted Run
  -> execd
       -> identityd.IssueRunInvocation
       <- short-lived Run-origin invocation JWT

logout credential
  -> authd
       -> identityd.RevokeSession   Authd workload mTLS
            -> auditd.RecordAuditBatch   actual mutation only
```

Authd never names an account. Identityd resolves the current external identity
link and standing before creating a Session. Edged never names an account or
Actor. Execd names the Actor attached to its Run but never names an attached
account. Identityd alone derives `sub`, optional `act.sub`, issuer, audience,
origin, times, and key.

Session credentials never leave Authd, the browser cookie, Edged, and
Identityd. Invocation-signing private material never leaves Identityd.
Authd receives provider settings and credentials only from the Configd-owned,
purpose-bound deployed projection defined by Authd; it makes no Configd call.

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
mutation event. Identityd audits only successful Session creation and an
actual Session revocation.

## Complete call inventory

| Caller | Callee | Purpose |
| --- | --- | --- |
| `tenantd` | `identityd.GetInvocationVerificationKeys` | Validate invocation JWTs |
| `tenantd` | `policyd.CheckAccess` | Authorize one Tenantd capability |
| `tenantd` | `auditd.RecordAuditBatch` | Record one committed Tenant or Workspace mutation |
| `policyd` | `identityd.GetInvocationVerificationKeys` | Independently validate the invocation |
| `policyd` | `identityd.ResolvePrincipal` | Obtain current exact-target identity and standing facts |
| `policyd` | `identityd.ListPrincipalGroups` | Obtain bounded pages of direct Group IDs |
| `authd` | `identityd.CreateSession` | Resolve a validated external identity and create one Session |
| `authd` | `identityd.RevokeSession` | Revoke one Session by opaque credential |
| `edged` | `identityd.ExchangeSession` | Exchange one current Session for an exact-target invocation |
| `execd` | `identityd.IssueRunInvocation` | Issue an exact-target invocation for one owned Run |
| `identityd` | `auditd.RecordAuditBatch` | Record one committed Session creation or actual revocation |

No other kernel-to-kernel call is approved by this specification.

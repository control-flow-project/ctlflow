---
title: edged
weight: 70
---

`edged` is the external reverse proxy for product management, browser, application, webhook, and
other admitted external HTTP traffic. It owns no Tenant, route, App, or endpoint truth.

## Activities

- Accept external HTTP, streaming HTTP, WebSocket, and required HTTP/2 traffic.
- Reject authentication protocol routes owned by public `authd`.
- Resolve the Tenant root and then any Workspace address segment through `tenantd`.
- Exchange browser Sessions or validate admitted external credentials through `identityd`.
- Ask `policyd` for the required coarse management or application operation.
- Resolve the exact current App exposure through `pkgd`.
- Resolve the exact ready endpoint through `execd`.
- Ask `execd` to realize an admitted start-on-demand App.
- Create a trusted external request context and obtain the invocation JWT when an Actor exists.
- Remove caller-supplied protected identity and routing headers.
- Create or continue validated W3C trace context and propagate it independently of identity.
- Proxy request and response with finite body, stream, timeout, and concurrency bounds.
- Serve immutable UI artifacts resolved by digest through `pkgd`, validating bytes obtained through
  its purpose-bound artifact transfer before caching them.
- Maintain bounded resolution caches and expose cache, drain, health, and readiness operations.
- Emit attributable allow, deny, target, status, and latency evidence.

## Resolution

```text
 external request
      |
      v
 tenantd ----> Tenant, then optional Workspace
 identityd --> authenticated Actor and invocation JWT
 policyd ----> coarse authorization
 pkgd -------> exact App exposure
 execd ------> exact ready endpoint and Placement
      |
      v
 target runtime proxy -> application
```

Routes are inferred from current owner state. There is no create, update, or delete route API.
`edged` first resolves the exact Tenant root through `tenantd`. If the remaining path contains the
fixed `/workspaces/<workspace-address>` boundary, it then resolves that exact Workspace inside the
resolved Tenant. Product URL design below the address root must identify the exposure with
structurally separate fixed and user-controlled segments. `edged` uses the resulting structured
route identity and canonical remaining path.

## Authentication and context

For a browser request, `edged` resolves the opaque Session through its bounded invocation cache or
private `identityd` on a miss. The Session cookie is never forwarded or stored in plaintext.
`identityd` derives current identity facts and issues one invocation JWT for the installation's
internal audience. `edged` supplies that token and its own Kubernetes workload identity to the
target runtime proxy.

For an external webhook or API endpoint, the Package exposure declares its external authentication
class. Anonymous or provider-authenticated traffic receives no invented Tenant User Actor.
Application-specific signature verification remains application behavior.

For explicitly admitted unauthenticated traffic, `edged` is the immediate caller and Actor and
source Placement are absent. That context cannot be exchanged as a human invocation; any outbound
call is autonomous as the target App's virtual principal.

Every protected caller header is removed before trusted Actor, caller, Tenant, Workspace, and
Placement context is attached. W3C trace context is validated and propagated separately; it never
becomes an identity fact.

## Start on demand

If an exposure belongs to an admitted start-on-demand App with no ready endpoint, `edged` asks
`execd` to realize the exact App generation. The request waits only within bounded startup policy.
It never selects another App or stale endpoint as fallback.

## Caching

`edged` keeps separate bounded in-memory caches for the two narrow `tenantd` address projections.
The Tenant cache key is the normalized external authority and canonical Tenant path prefix; its
value contains only Tenant ID, binding generation, and expiry. The Workspace cache key is Tenant ID
and Workspace address segment; its value contains only Workspace ID, binding generation, and
expiry. Neither cache contains a Tenant or Workspace administrative record.

A miss or expiry in either address cache calls `tenantd` for that exact hierarchy step. Entry
expiry is the earlier of the owner-supplied expiry and 60 seconds. There is no invalidation stream,
durable route cache, or second route database.

The resolved App exposure and endpoint projection is cached separately. Its expiry is no later than
the address expiry, the endpoint lifetime supplied by `execd`, or 60 seconds. A cache miss calls the
owning services and never selects another target as fallback.

`edged` may cache a Session-to-invocation projection under a keyed digest of the Session credential.
The entry expires no later than the invocation JWT and never exceeds 60 seconds. It contains no
cookie value or authorization decision. Revocation therefore has the same bounded consequence as an
already issued JWT and does not require a separate invalidation stream.

The digest key is generated into process-private memory at startup and is never persisted, shared,
or exposed. Restarting `edged` therefore starts with a cold Session cache.

Authorization decisions are request-specific and are never reused as cached allows. A cached target
must still validate the current invocation JWT, immediate workload identity, and operation.

Drain blocks new proxied work while allowing bounded active streams to finish. Cache refresh and
inspection are operational controls and never mutate domain state.

## Direct operations

| Operation | Purpose |
| --- | --- |
| Proxy | Resolve, authorize, and proxy one external request |
| Preview | Return the same resolution decision without proxying |
| RefreshCache | Evict or refresh bounded derived entries |
| GetCacheStats | Return bounded operational cache evidence |
| Drain / Undrain | Control admission during maintenance |
| Health / Ready | Report process and dependency readiness |

## Invariants

- A request resolves to one exact App exposure and endpoint generation.
- `edged` never trusts a browser cookie or bearer without `identityd` validation.
- `edged` never creates a Tenant, App, route, Placement, or endpoint.
- A warm address-cache hit does not call `tenantd`; a miss or expired entry always does.
- Cached state can delay recovery but cannot widen authorization or change target identity.
- Authentication protocols are served by `authd`, not routed as an `edged` application exposure.
- Internal App-to-App calls do not traverse `edged`.
- Request and response bodies are never audit payloads.

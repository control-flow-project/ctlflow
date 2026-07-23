---
title: edged
weight: 70
---

`edged` is the external reverse proxy for product management, browser, application, webhook, and
other admitted external HTTP traffic. It owns no Tenant, route, App, or endpoint truth.

## Activities

- Accept external HTTP, streaming HTTP, WebSocket, and required HTTP/2 traffic.
- Resolve Tenant and optional Workspace address through `tenantd`.
- Validate browser sessions, product credentials, or admitted external authentication through
  `identityd`.
- Ask `policyd` for the required coarse management or application operation.
- Resolve the exact current App exposure through `pkgd`.
- Resolve the exact ready endpoint and audience through `execd`.
- Ask `execd` to realize an admitted start-on-demand App.
- Create a trusted external request context.
- Remove caller-supplied protected identity and routing headers.
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
 tenantd ----> Tenant and optional Workspace
 identityd --> authenticated Actor
 policyd ----> coarse authorization
 pkgd -------> exact App exposure
 execd ------> exact ready endpoint, Placement, and audience
      |
      v
 target runtime proxy -> application
```

Routes are inferred from current owner state. There is no create, update, or delete route API.
Product URL design must identify Tenant, optional Workspace, and exposure with structurally
separate fixed and user-controlled segments. `tenantd` resolves the admitted address and `edged`
uses the resulting structured route identity and canonical remaining path.

## Authentication and context

For a browser request, `edged` validates the opaque session through `identityd`. The session cookie
is never forwarded. `identityd` issues an exact-audience credential and `edged` supplies it to the
target runtime proxy.

For an external webhook or API endpoint, the Package exposure declares its external authentication
class. Anonymous or provider-authenticated traffic receives no invented Tenant User Actor.
Application-specific signature verification remains application behavior.

For explicitly admitted unauthenticated traffic, `edged` is the immediate caller and Actor and
source Placement are absent. That context cannot be exchanged as a human invocation; any outbound
call is autonomous as the target App's virtual principal.

Every protected caller header is removed before trusted Actor, caller, Tenant, Workspace, Placement,
request, and trace context is attached.

## Start on demand

If an exposure belongs to an admitted start-on-demand App with no ready endpoint, `edged` asks
`execd` to realize the exact App generation. The request waits only within bounded startup policy.
It never selects another App or stale endpoint as fallback.

## Caching

`edged` keeps a bounded in-memory cache of the narrow `tenantd` external-address projection. Its key
is the normalized external authority and admitted path prefix. Its value contains only the
canonical Tenant ID, optional Workspace ID, address-binding generation, and expiry. It does not
cache the Tenant or Workspace administrative record.

An address-cache miss or expiry calls `tenantd`. Entry expiry is the earlier of the owner-supplied
expiry and 60 seconds. There is no invalidation stream, durable route cache, or second route
database.

The resolved App exposure and endpoint projection is cached separately. Its expiry is no later than
the address expiry, the endpoint lifetime supplied by `execd`, or 60 seconds. A cache miss calls the
owning services and never selects another target as fallback.

Session validation and authorization decisions are request-specific and are not reused as cached
allows. A cached target must still accept the request's current exact-audience credential.

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
- Internal App-to-App calls do not traverse `edged`.
- Request and response bodies are never audit payloads.

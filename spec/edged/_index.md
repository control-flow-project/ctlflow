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
- Exchange browser Sessions through `identityd` when the exposure requires a CtlFlow Actor.
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
 pkgd -------> exact App exposure
 identityd --> authenticated Actor and invocation JWT when required
 policyd ----> coarse authorization
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

Every exposure declares exactly one authentication class:

```text
session                    require a valid CtlFlow Session and invocation JWT
application-authenticated preserve only declared application credential fields for the App
anonymous                  establish no external identity
```

Application-authenticated webhook or API traffic receives no invented Tenant User Actor.
Signature, token, replay, and object authorization remain application behavior. Only credential
fields explicitly declared by that exposure survive filtering, and they are never copied into
trusted CtlFlow context, audit payload, or telemetry.

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
The Tenant cache key is the Tenant address segment; its value contains only Tenant ID, state,
revision, and local expiry. The Workspace cache key is Tenant ID and Workspace address segment; its
value contains only Workspace ID, state, revision, and local expiry. Neither cache contains a
Tenant or Workspace administrative record.

A miss or expiry in either address cache calls `tenantd` for that exact hierarchy step. Entry
expiry follows one finite `edged` policy and never exceeds 60 seconds. `tenantd` does not supply
cache policy. There is no invalidation stream, durable route cache, or second route database.

The resolved App exposure and endpoint projection is cached separately. Its expiry is no later than
the local address-cache expiry, the endpoint lifetime supplied by `execd`, or 60 seconds. A cache
miss calls the owning services and never selects another target as fallback.

`edged` may cache a Session-to-invocation projection under a keyed digest of the Session credential.
The entry expires no later than the invocation JWT and never exceeds 60 seconds. It contains no
cookie value or authorization decision. Revocation therefore has the same bounded consequence as an
already issued JWT and does not require a separate invalidation stream.

The digest key is generated into process-private memory at startup and is never persisted, shared,
or exposed. Restarting `edged` therefore starts with a cold Session cache.

Authorization decisions are request-specific and are never reused as cached allows. A cached target
must still validate the current invocation JWT, immediate workload identity, and operation.

Drain blocks new proxied work while allowing bounded active streams to finish. Cache eviction and
inspection are operational controls and never mutate domain state.

## Direct operations

| Operation | Surface | Purpose |
| --- | --- | --- |
| ProxyRequest | public HTTP catch-all outside the authentication prefix | Resolve, authorize, and proxy one external request |
| PreviewRequest | private operator diagnostic | Return the same bounded target decision without proxying |
| EvictCacheEntry | private operator diagnostic | Remove one exact derived cache key or one bounded owner partition |
| GetCacheStats | private operator diagnostic | Return bounded counts, age, hit/miss, and capacity evidence |
| Drain | private operational control | Stop admission during maintenance and begin a bounded active-request drain |
| Undrain | private operational control | Restore admission after dependencies and owner facts are ready |
| Health | private Kubernetes probe listener | Report whether the process is live |
| Ready | private Kubernetes probe listener | Report whether required dependencies permit admission |

### Proxy contract

The public request supplies only authority, method, target path/query, headers, body or stream, and
optional browser credential. `edged`:

1. canonicalizes authority and path and resolves the Tenant then optional Workspace;
2. rejects the fixed `/_ctlflow/auth/` family owned by `authd`;
3. asks `pkgd` to match method and canonical remaining path to one exact installed exposure;
4. applies its exact session, application-authenticated, or anonymous class;
5. asks `policyd` for the exposure's declared coarse operation;
6. resolves or starts the exact current endpoint through `execd`; and
7. streams to the target runtime proxy under finite limits.

An exposure declares one unambiguous fixed route root plus whether trailing path is application
data. App installation rejects overlapping active roots in the same Tenant/Workspace and method
set. User-controlled route values occupy declared segment positions; they never compete with the
fixed authentication, Tenant, or Workspace boundaries. `edged` performs no arbitrary regular
expression, "best match," filesystem, or fallback routing.

The trusted upstream projection contains only validated method, canonical application path/query,
filtered headers, established Tenant/Workspace, Actor/subject and immediate-caller context,
invocation JWT when one exists, and W3C trace context. The browser cookie, public authorization,
forwarded identity headers, original authority, and routing internals are not forwarded.

Response status, headers, body, streaming, upgrade, compression, timeout, disconnect, and
backpressure follow the exposure's finite protocol bounds. `edged` does not buffer an unbounded
body, retry a non-idempotent application request, convert protocols, inspect application records,
or replace an application error with a successful kernel response.

### External outcomes

Malformed authority/path/header/body is `400`; missing or invalid required external
authentication is `401`; valid identity without exposure authority is `403`; invisible Tenant,
Workspace, exposure, or target is the same `404`; method mismatch is `405` only when revealing the
route is admitted; finite limit exhaustion is `413`, `429`, or `503` according to the exhausted
boundary; startup/dependency timeout is `503` or `504`. Internal IDs, policy reasons, dependency
names, native endpoints, credentials, and provider errors never enter the public response.

`PreviewRequest` accepts the same canonical routing facts but no body and never starts an App. It
returns only resolved owner IDs visible to the operator, exposure and endpoint generations,
authentication class, decision class, cache expiries, and stable failure layer. It is not available
to ordinary external callers.

Cache eviction cannot insert or mutate an entry. Drain returns `503` for new work, exposes one
bounded retry hint, and lets already accepted streams run only until their existing deadlines.

## Callers and dependencies

| Callee | Operation | Purpose |
| --- | --- | --- |
| `tenantd` | ResolveTenant, ResolveWorkspace | Resolve the external address hierarchy |
| `pkgd` | ResolveExposure, AuthorizeArtifactTransfer | Resolve one route declaration or immutable UI digest |
| `identityd` | ExchangeSession | Establish current Actor and invocation JWT on a cache miss |
| `policyd` | CheckAccess | Authorize the exposure's declared coarse operation |
| `execd` | ResolveEndpoint, StartAppOnDemand | Resolve only the exact current target |
| `auditd` | RecordAuditBatch | Record required ingress decisions |

`edged` calls dependencies after parsing bounded request metadata and before forwarding a body.
Where HTTP semantics permit, it does not consume the request stream until routing, authentication,
and authorization succeed.

## Verification

Canonical evidence covers every supported HTTP and streaming mode, authority/path
canonicalization, Tenant and Workspace hierarchy, route collision rejection, fixed authentication
route exclusion, every exposure authentication class, Session-cache expiry/revocation bound,
coarse denial, invisible-target equivalence, start-on-demand success/failure, UI digest validation,
request/response limits, disconnect and backpressure, trace propagation, protected-header
stripping, cache hit/miss/expiry/eviction, drain, dependency outage, public error redaction, and
required audit/telemetry evidence. Browser tests exercise real ingress routing and runtime proxies.

## Invariants

- A request resolves to one exact App exposure and endpoint generation.
- `edged` never trusts a browser cookie or bearer without `identityd` validation.
- `edged` never creates a Tenant, App, route, Placement, or endpoint.
- A warm address-cache hit does not call `tenantd`; a miss or expired entry always does.
- Cached state can delay recovery but cannot widen authorization or change target identity.
- Authentication protocols are served by `authd`, not routed as an `edged` application exposure.
- Internal App-to-App calls do not traverse `edged`.
- Request and response bodies are never audit payloads.

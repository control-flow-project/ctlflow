---
title: authd
weight: 45
---

`authd` is the public authentication-protocol boundary. It accepts only the
three browser routes declared on this page, owns no durable domain record, and
has no private inbound RPC.

## Boundary

`authd` is responsible for:

- selecting one exact configured Tenant and provider for a browser
  authentication attempt;
- mediating that provider protocol through a bounded installed adapter;
- binding the provider callback to one browser and one finite in-flight
  attempt;
- converting one validated provider subject into an Identityd Session;
- setting and clearing the opaque Session cookie;
- revoking the Session named by that cookie during logout;
- enforcing public origin, CSRF, redirect, request, concurrency, and rate
  bounds; and
- mapping every public failure to a bounded, non-disclosing HTTP response.

`identityd` owns accounts, external identity links, Sessions, and invocation
identity. `configd` owns provider configuration and secret custody. Authd never
creates, modifies, infers, caches, or persists one of those records as an
independent authority.

Authd makes only these kernel calls:

```text
authd -> identityd.CreateSession
authd -> identityd.RevokeSession
```

Provider HTTPS is an external protocol boundary, not a kernel call. Authd does
not call Configd, Auditd, Tenantd, Edged, Egressd, or another private service.

## Version 1 HTTP surface

The complete public browser surface is:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/v1/begin` | Begin one authentication attempt |
| `GET` | `/auth/v1/callback` | Complete the selected provider callback |
| `POST` | `/auth/v1/logout` | Revoke and clear the current Session |

No other public Authd route or method exists. In particular, there is no
discovery document, provider list, provider catalog, administration, Session
list, Session introspection, identity proxy, generic HTTP proxy, refresh,
status, user-info, or private gRPC surface. `HEAD` is not an alias for the
callback. `OPTIONS` does not create a CORS surface.

The process may expose `/healthz` and `/readyz` only on the separate
installation probe listener. Those endpoints are not reachable through the
public listener and are not authentication operations.

## Public origin and common HTTP behavior

The Configd-owned non-secret projection supplies one canonical HTTPS public
origin. It contains scheme, host, and optional non-default port, with no path,
query, fragment, or user information. Authd constructs its one callback URI as:

```text
<canonical-public-origin>/auth/v1/callback
```

Authd never derives the public origin, callback URI, Tenant, provider, or
return target from `Host`, `Forwarded`, `X-Forwarded-*`, a provider response, or
another caller-controlled header. The installation ingress preserves the
canonical HTTP authority and removes untrusted forwarding headers. Authd
rejects a request whose effective authority is not the configured authority.

Every response from a declared route carries:

```text
Cache-Control: no-store
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'
```

A success redirect is `303 See Other`, has an empty body, and contains one
`Location`. Authd emits no permanent redirect. Error responses use
`Content-Type: text/plain; charset=utf-8` and the exact body:

```text
Request could not be completed.
```

An error body or header never contains a Tenant ID, provider ID, provider
subject, account fact, Session fact, callback value, dependency status, state
value, cookie value, or return target. A success `Location` contains only the
configured provider URL or validated same-origin return target required by
that route. Authd emits no `WWW-Authenticate` header and no CORS response
header.

An unknown path is `404 Not Found`. A method other than the one declared for a
known path is `405 Method Not Allowed` with only that method in `Allow`.

Form and query percent-decoding is strict UTF-8. Invalid escapes, invalid
UTF-8, and decoded NUL are `400 Bad Request`. A form media type may have no
parameter or only `charset=UTF-8`, compared case-insensitively; another media
type or parameter is `415 Unsupported Media Type`.

## Selection and return targets

Tenant IDs and provider IDs are one to 64 lower-case ASCII characters, start
alphanumeric, and otherwise contain only alphanumeric characters, `_`, or
`-`. Authd validates the two values independently, then selects the exact
`(tenant_id, provider_id)` entry in its resolved projection. There is no
default, host-derived, path-derived, remembered, or fallback Tenant or
provider.

`return_to` is optional. Its default is `/`. A supplied value must be an ASCII
HTTP origin-form path and optional query of at most 2,048 bytes. It must:

- begin with exactly one `/`;
- contain no scheme, authority, user information, fragment, backslash, ASCII
  control, space, or invalid percent encoding; and
- resolve against the configured public origin to that exact same origin.

Authd canonicalizes percent-encoding without decoding a path delimiter and
stores or returns only the validated origin-form value. An absolute URL,
network-path reference beginning `//`, encoded backslash, or value that
changes origin is `400 Bad Request`. A return target is never sent to the
provider.

## Begin authentication

`POST /auth/v1/begin` accepts exactly
`application/x-www-form-urlencoded` with these fields:

| Field | Cardinality | Meaning |
| --- | --- | --- |
| `tenant_id` | exactly one | Canonical target Tenant ID |
| `provider_id` | exactly one | Canonical provider ID inside that Tenant |
| `return_to` | zero or one | Validated same-origin return target |

An absent, duplicate, empty, malformed, or unknown field is `400 Bad Request`.
JSON, multipart data, and an empty media type are not admitted.

The request must contain exactly one `Origin` equal to the canonical public
origin. A missing, `null`, malformed, duplicate, or different Origin, or a
different effective authority, is `403 Forbidden`. No Session cookie is
required and a supplied Session cookie does not select identity.

This exact Origin check is Begin's login-CSRF defense. `Referer`,
`Sec-Fetch-*`, a return target, and SameSite cookie behavior do not substitute
for it.

After validating the request, Authd:

1. selects the exact projected Tenant/provider entry;
2. removes any live attempt bound to a valid existing state cookie;
3. allocates one random state handle and one independent browser-binding
   nonce;
4. stores one bounded in-flight record;
5. asks only the selected installed adapter to construct the provider
   authorization redirect from projected configuration, the fixed callback
   URI, and the random state handle; and
6. returns `303 See Other` to that configured HTTPS provider endpoint.

The response sets the state cookie defined below. The `Location` origin and
path come only from the selected projection and adapter and the complete
Location is at most 4,096 bytes. Begin performs no provider metadata discovery,
provider back-channel request, or kernel call.

An unknown Tenant/provider pair produces the same `400 Bad Request` as another
inadmissible selection and allocates no state. A selected entry or adapter that
violates its startup-validated invariant is the common `503 Service
Unavailable`; Authd deletes the newly allocated record and sets no state
cookie. A full state store or exceeded request rate is
`429 Too Many Requests`; Authd does not evict a live attempt to admit a new
one.

## Provider callback

`GET /auth/v1/callback` accepts no request body. It requires exactly one
`state` query value: the 43-character unpadded base64url encoding of the
32-byte state handle issued by Begin. The remaining query fields are accepted
only when the selected installed adapter defines them as its callback input.
Duplicate `state`, duplicate fields forbidden by the adapter, unknown fields,
and fields outside the callback bounds are `400 Bad Request`.

An adapter's callback field names, cardinalities, and parsing rules are fixed
checked implementation behavior. A projected entry supplies settings and
credentials but cannot add a callback field, method, path, body, or header.

The callback does not require or trust `Origin`: it is a top-level redirect
from an external provider. Instead, Authd hashes the supplied state handle,
loads the matching live record, and requires the state cookie to contain the
record's independent browser-binding nonce. Both comparisons are constant
time. Missing, malformed, expired, replayed, or mismatched state is the same
`400 Bad Request`.

After those checks and request admission, Authd atomically consumes the record
before provider validation. The selected adapter:

- receives only its bounded callback fields and the protocol material in that
  record;
- validates the exact configured provider, callback URI, correlation,
  freshness, signature or proof, and protocol result;
- uses only exact projected HTTPS endpoints for any required back-channel
  request; and
- returns either one exact case-sensitive provider subject or a closed
  failure.

The provider subject must be non-empty and at most 512 characters. It is never
accepted from Begin, state, a generic identity header, or an unvalidated
callback field.

On a valid provider result, Authd calls:

```text
identityd.CreateSession(tenant_id, provider_id, provider_subject)
```

The Tenant and provider come only from consumed state. Authd never supplies an
account ID. On success, Authd base64url-encodes the returned exact 32-byte
credential, sets the Session cookie, clears the matched state cookie, and
returns `303 See Other` to the stored return target.

Success replaces any existing Session cookie in that browser. It does not
inspect or revoke the credential that cookie previously held; beginning a new
authentication attempt is not logout, and the replaced Session retains its
finite Identityd expiry.

A provider rejection, invalid provider result, or Identityd
`UNAUTHENTICATED` is `401 Unauthorized` with the common error body. It does not
reveal whether an external identity link, account, or Membership exists. A
matched state cookie is cleared after every consumed attempt, including
failure. An unmatched callback does not clear a different live attempt.

If Identityd commits a Session but the browser disconnects before receiving
the cookie, that Session remains inaccessible and expires normally. Authd
does not add a compensating, retry, list, or introspection path.

Version 1 deliberately admits only this bounded GET callback shape. An adapter
that requires a callback body, another callback method, or another public path
requires an explicit future HTTP-contract change; it cannot widen this route
at runtime.

## Logout

`POST /auth/v1/logout` accepts exactly
`application/x-www-form-urlencoded` with zero fields or one optional
`return_to` field. Any other, duplicate, or malformed field is
`400 Bad Request`.

The request must carry the same exact Origin and authority checks as Begin.
The Session cookie is usable only when exactly one cookie value is present and
it is the 43-character unpadded base64url encoding of 32 bytes.

The mandatory Origin check and `SameSite=Lax` cookie are Logout's CSRF
defenses. There is no alternate query-string logout or cross-origin form path.

- For a usable credential, Authd calls
  `identityd.RevokeSession(credential)`.
- A missing, duplicate, or malformed cookie requires no kernel call.
- Identityd `UNAUTHENTICATED` is treated as already logged out.

Successful revocation, already-revoked state, an unknown credential, and an
absent or malformed cookie all clear both Authd cookies and return
`303 See Other` to the validated return target. They are intentionally
indistinguishable.

Identityd transport, admission, deadline, or availability failure is
`503 Service Unavailable`. In that case Authd does not clear the Session cookie
or redirect, so the browser can retry revocation. Authd never treats local
cookie deletion alone as successful revocation after submitting a usable
credential.

## Cookies

The complete Authd cookie inventory is:

| Name | Value | Attributes |
| --- | --- | --- |
| `__Host-ctlflow-auth-state` | Independent 32-byte random browser-binding nonce, unpadded base64url | `Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600` |
| `__Host-ctlflow-session` | Identityd's exact 32-byte opaque credential, unpadded base64url | `Path=/; Secure; HttpOnly; SameSite=Lax` plus Session expiry |

Neither cookie has a `Domain` attribute. The state cookie contains no state
handle, Tenant, provider, return target, provider material, or Session value.

The Session cookie's `Expires` is Identityd's returned absolute Session expiry
rounded down to an HTTP-date second. `Max-Age` is the non-negative whole-second
remainder at response time and cannot exceed 2,592,000 seconds. Authd does not
extend or refresh it.

Clearing a cookie uses the same name, `Path=/`, `Secure`, `HttpOnly`, and
`SameSite=Lax`, with `Max-Age=0` and
`Expires=Thu, 01 Jan 1970 00:00:00 GMT`. Cookie values never appear in a
response body, redirect, log, metric, trace attribute, exception, or audit
payload.

## Bounded in-flight state

Each in-memory attempt contains only:

```text
SHA-256 state-handle digest
SHA-256 browser-binding nonce digest
Tenant ID
provider ID
validated return target
selected adapter identity
adapter-owned protocol correlation material
creation and expiry instants
```

The handle and browser nonce are independent CSPRNG outputs. A record is at
most 16 KiB, expires exactly 10 minutes after creation, and is consumed at
most once. One Authd process holds at most 4,096 live records and at most one
usable record per browser-binding cookie. Expired records are removed with
bounded work. Capacity exhaustion admits no new record and never extends,
spills, or evicts a live one.

State is process-local and never written to a database, file, distributed
cache, cookie payload, Configd record, log, telemetry event, or audit event.
Restart and orderly shutdown discard it. A callback whose record was lost on
restart fails as invalid state and the browser must begin again. Replicas must
use ingress affinity for the state cookie's 10-minute lifetime; replication,
shared state, and failover replay are not part of the v1 contract.

## Configd projection

Authd makes no Configd call. Before starting Authd, Configd materializes one
purpose-bound provider projection for the exact Authd workload. The deployed
projection has two disjoint, read-only process-private files:

1. a non-secret resolved manifest containing the canonical public origin and a
   finite set of exact Tenant/provider entries; and
2. a secret projection containing only the credential material referenced by
   those entries.

This preserves the separation between non-secret configuration and secret
custody. Both files are bound to the Authd workload and cannot be reused by
another consumer. Kernel TLS trust, client certificates, and private keys are
installation bootstrap material and are not part of this Configd projection.

The manifest has at most 4,096 Tenant/provider entries and is at most 4 MiB.
The secret projection is at most 4 MiB. Each entry names exactly one installed
adapter, exact HTTPS provider endpoints and trust requirements, exact callback
expectations, bounded adapter settings, and secret references. It contains no
account or external-identity link.

Authd reads and validates both files once at startup, resolves every reference,
and then treats the resulting generation as immutable. Missing, malformed,
oversized, duplicate, dangling, non-HTTPS, or adapter-incompatible material
fails startup and readiness. Config changes and secret rotation produce a new
projection and a replacement Authd process; there is no watch, polling,
fallback file, last-known-good reload, runtime discovery, or provider catalog
API.

## Provider boundary

The HTTP contract is provider-protocol-generic. It names no provider protocol,
endpoint schema, claim name, credential type, or provider catalog. A projected
entry selects an already installed adapter; a request cannot select adapter
code or supply an endpoint.

During one consumed callback, an adapter may make at most two HTTPS
back-channel requests. Each has a five-second deadline, at most 16 KiB of
response headers, and at most 256 KiB of response body. Redirect following is
disabled. DNS, connection, TLS, response, and parsing work are cancellation
aware and use exact projected destinations and trust. Long-lived bounded HTTP
clients are reused.

Provider responses are parsed by the adapter and are never proxied to the
browser, Identityd, or another service. The only semantic provider result that
leaves the adapter is the exact provider subject or a closed failure.

## Abuse, cancellation, and deadlines

The public listener enforces these process-local bounds:

| Resource | Bound |
| --- | --- |
| Total request headers | 16 KiB |
| Total cookies | 8 KiB |
| Begin or Logout body | 4 KiB |
| Callback request target | 16 KiB |
| Callback query fields | at most 32; name at most 128 bytes; value at most 4 KiB |
| Concurrent public requests | 128 |
| Concurrent consumed callbacks | 32 |
| Live in-flight attempts | 4,096 |

Begin and Logout each use a process-wide token bucket with capacity 20 and a
refill of 120 requests per minute. Callback uses capacity 40 and a refill of
240 requests per minute. The installation ingress additionally applies finite
source-aware limits before Authd. A local rate, concurrency, or state-capacity
rejection is `429 Too Many Requests` with an integer `Retry-After` from one
through 60 seconds. An oversized body is `413 Content Too Large`, request
target is `414 URI Too Long`, and header or cookie section is
`431 Request Header Fields Too Large`.

There is no unbounded admission queue, request body, response body, provider
body, state collection, retry queue, task, or telemetry queue.

The end-to-end deadlines are:

| Work | Deadline |
| --- | --- |
| Begin request | 2 seconds |
| Callback request | 15 seconds |
| One provider back-channel request | 5 seconds within the callback deadline |
| `Identityd.CreateSession` | 3 seconds within the callback deadline |
| Logout request | 5 seconds |
| `Identityd.RevokeSession` | 3 seconds within the logout deadline |

Authd uses the smaller of the operation limit and remaining public deadline.
It propagates browser disconnect, server shutdown, and deadline cancellation
to provider I/O and Identityd. It performs no automatic provider or Identityd
retry. Cancellation before a response is committed emits no replacement
response; an observable dependency deadline is the common
`503 Service Unavailable`.

## Identityd workload mTLS

Authd reaches Identityd through one pooled HTTP/2 gRPC channel using mutual
TLS. Authd validates Identityd's server certificate chain against the
installation kernel server trust anchor and requires the exact configured
Identityd DNS identity. Accept-any callbacks, system-root fallback, name
fallback, plaintext, and TLS downgrade are forbidden.

Each Authd process receives one process-private client certificate and private
key through installation bootstrap files. Identityd validates certificate
validity, client-auth usage, the installation workload client trust anchor,
and the exact configured certificate subject before mapping it to
`SERVICE/svc_authd`. A header, request field, Kubernetes name, shared
certificate, or browser credential cannot replace that identity.

`CreateSession` and `RevokeSession` carry no Kubernetes bearer token and no
invocation JWT. They carry only the mTLS workload identity, their typed
request, finite gRPC deadline and cancellation, and W3C trace context. Client
key material is never an environment value, Configd provider credential,
cookie, log, telemetry value, or provider credential.

## Error mapping

| Condition | Public result |
| --- | --- |
| Unknown path | `404 Not Found` |
| Wrong method on a declared path | `405 Method Not Allowed` |
| Malformed fields, selection, return target, state, or callback | `400 Bad Request` |
| Missing or mismatched Origin or authority | `403 Forbidden` |
| Provider rejection or invalid result; CreateSession `UNAUTHENTICATED` | `401 Unauthorized` |
| Request body bound exceeded | `413 Content Too Large` |
| Request-target bound exceeded | `414 URI Too Long` |
| Form media type not admitted | `415 Unsupported Media Type` |
| Header or cookie bound exceeded | `431 Request Header Fields Too Large` |
| Rate, concurrency, or in-flight capacity exceeded | `429 Too Many Requests` |
| Provider response bound exceeded; provider, projection, mTLS, Identityd, or deadline unavailable | `503 Service Unavailable` |
| Unexpected internal invariant failure | `500 Internal Server Error` |

Identityd `INVALID_ARGUMENT` after Authd validation and
`PERMISSION_DENIED` for Authd are service incompatibility and map to the common
`503`, not caller detail. Logout alone treats RevokeSession
`UNAUTHENTICATED` as already logged out. Raw provider, certificate, gRPC,
network, parser, configuration, stack, and token diagnostics never cross the
public boundary.

## Telemetry and audit

The three stable public operation names are:

```text
authd.http.begin
authd.http.callback
authd.http.logout
```

Each route extracts valid W3C trace context only as correlation and applies
installation sampling. Authd creates child spans for provider work and injects
the resulting trace context into Identityd calls. It never sends CtlFlow trace
headers or baggage to an external provider.

Bounded traces, metrics, and structured logs may contain the route template,
HTTP method, status code, closed outcome class, adapter implementation name,
state-store saturation, and dependency class and latency. They never contain
Tenant IDs, provider IDs, provider subjects, account or Membership facts,
return targets, request or response bodies, query values, cookies, state,
nonces, verifiers, credentials, secrets, certificate material, provider
payloads, or raw exception text. No unbounded identifier is a metric
dimension.

Telemetry export is asynchronous and bounded. Collector failure does not
change an HTTP result or readiness and cannot retain protocol state.

Authd has no direct Auditd call and no audit delivery state. Identityd owns and
directly records successful Session creation and actual revocation. Begin,
provider rejection, malformed callback, public rejection, and Authd dependency
failure create bounded operational telemetry only; they do not invent an
authoritative Authd audit contract.

## Verification

Canonical Authd evidence must use the shipping public listener, a real
Identityd implementation, the production mTLS channel, mounted Configd-shaped
projection files, and a separately running controlled HTTPS provider
boundary. The provider control endpoint is test-only, separately bound, and
unreachable from the Authd public and provider clients. It controls finite
provider outcomes but does not replace Identityd, bypass an adapter, weaken
TLS, or create a production route.

The protocol-generic core suite uses one controlled installed adapter to prove
the common contract. Every additional shipping adapter repeats the controlled
provider success, rejection, malformed, oversized, TLS, deadline, and
cancellation boundary evidence for its fixed callback schema. Test adapters
and control endpoints are not a production provider catalog.

The complete evidence inventory covers:

- exactly the three route-method pairs and rejection of every other public
  method and path;
- exact form, query, authority, Origin, content-type, return-target, response,
  redirect, security-header, and cookie behavior;
- exact Tenant/provider selection with no defaults, discovery, or catalog;
- provider success, rejection, malformed result, oversized result, wrong
  endpoint, TLS failure, timeout, and cancellation;
- one-time browser-bound state, expiry, replay, mismatch, replacement,
  capacity, restart loss, and replica affinity;
- CreateSession mapping without an account ID and RevokeSession mapping with
  the exact cookie credential;
- exact workload-mTLS server and client validation, admitted Authd identity,
  unadmitted identity, expiry, rotation, and absence of bearer or invocation
  metadata;
- Session cookie issuance and logout behavior for active, revoked, unknown,
  missing, malformed, duplicate, and dependency-failed credentials;
- every public error mapping without identity, provider, configuration, or
  dependency disclosure;
- request-size, provider-response, concurrency, rate, state, deadline, and
  cancellation bounds;
- trace continuity to Identityd, no external trace propagation, redacted
  telemetry, bounded dimensions, and Collector outage; and
- startup and readiness failure for every invalid or incompatible projection,
  plus clean restart with no durable Authd state.

The checked HTTP inventory and evidence manifest fail if another route,
method, cookie, provider result, dependency call, or documented outcome
appears without matching normative specification and canonical evidence.

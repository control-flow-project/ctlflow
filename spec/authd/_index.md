---
title: authd
weight: 45
---

`authd` is the public authentication-protocol boundary. It owns no durable
identity, Session, configuration, provider, or other domain record and exposes
no private inbound RPC.

## Surface

The complete public browser contract is:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/v1/begin` | Begin one authentication attempt |
| `GET` | `/auth/v1/callback` | Complete the selected provider callback |
| `POST` | `/auth/v1/logout` | Revoke and clear the current Session |

There is no discovery, provider catalog, administration, Session list or
introspection, user-info, refresh, generic proxy, private RPC, or other public
route. `HEAD` and `OPTIONS` are not aliases. Health and readiness exist only on
the separate probe listener.

Every declared-route response carries `Cache-Control: no-store`,
`Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and a
`Content-Security-Policy` of
`default-src 'none'; frame-ancestors 'none'; base-uri 'none'`. Success is an
empty `303 See Other` with one `Location`. Errors never redirect, use
`Content-Type: text/plain; charset=utf-8`, and return the fixed body
`Request could not be completed.` without identity, provider, callback,
configuration, dependency, cookie, state, or return-target detail.

## Selection and browser protections

Begin selects one explicit `tenant_id` and `provider_id`. Both use Identityd's
one-to-64-character lower-case identifier shape. Authd selects only the exact
configured pair; there is no default, host inference, remembered selection, or
fallback.

`return_to` defaults to `/`. A supplied value is an ASCII same-origin
origin-form path and optional query of at most 2,048 bytes. It begins with one
`/` and contains no scheme, authority, fragment, backslash, control, space, or
invalid percent encoding. Authd never accepts or emits an external return
target.

The projected configuration supplies one canonical HTTPS public origin and
therefore the fixed callback URI:

```text
<public-origin>/auth/v1/callback
```

Begin and Logout require exactly one `Origin` equal to that origin and an
effective authority equal to its authority. Missing, `null`, malformed,
duplicate, or different values are `403 Forbidden`; forwarding headers cannot
replace them. These checks and `SameSite=Lax` cookies are the CSRF defense for
the two POST routes. Callback instead uses one-time state bound to the browser
because its top-level redirect comes from the external provider.

Form and query decoding is strict UTF-8. Invalid encoding or decoded NUL is
`400 Bad Request`. Form routes accept only
`application/x-www-form-urlencoded`, with no media-type parameter other than
optional UTF-8 charset.

## Begin

`POST /auth/v1/begin` accepts exactly:

```text
tenant_id    required once
provider_id  required once
return_to    optional once
```

After validation, Authd replaces any live attempt bound to the existing state
cookie, creates one random state handle and independent browser-binding nonce,
stores their digests with the selected pair, return target, adapter state, and
ten-minute expiry, and sets the state cookie.

The selected adapter constructs an HTTPS provider authorization URL from the
projected entry, fixed callback URI, and state handle. Authd makes no provider
request during Begin. It returns `303` to that URL, which is at most 4,096
bytes. Unknown selection is `400`; an invalid selected configuration is `503`.

## Callback

`GET /auth/v1/callback` accepts no body and requires exactly one 43-character
unpadded-base64url `state` query value. The selected installed adapter fixes
the remaining callback field names, cardinalities, and parser; configuration
cannot add a method, path, body, header, or callback field.

Authd requires a live state-handle digest and the independent state-cookie
nonce digest, compares them in constant time, and atomically consumes the
attempt before provider validation. Missing, malformed, expired, replayed, or
mismatched state is the same `400`.

Authd owns OAuth/OIDC construction, correlation, proof, provider-response
validation, and extraction of one exact case-sensitive provider subject of at
most 512 characters. Every Authd-originated provider back-channel request
crosses the selected purpose-bound Egressd endpoint; Authd never opens a
direct provider connection. Egressd owns external destination, TLS, redirect,
header, and body enforcement but does not interpret authentication semantics.

After validation, Authd calls:

```text
identityd.CreateSession(tenant_id, provider_id, provider_subject)
```

Tenant and provider come only from consumed state; Authd never supplies an
account ID. Success sets the Session cookie, clears the matched state cookie,
and returns `303` to the stored return target. A provider rejection, invalid
protocol result, or Identityd `UNAUTHENTICATED` is the same `401 Unauthorized`.
A consumed attempt clears its state cookie on failure.

A successful callback replaces any existing browser Session cookie but does
not inspect or revoke the replaced credential. A Session committed after the
browser disconnects remains finite and inaccessible; Authd adds no retry,
compensation, list, or introspection path.

## Logout

`POST /auth/v1/logout` accepts an empty form or one optional `return_to`.
Exactly one Session cookie value is usable only when it decodes from unpadded
base64url to 32 bytes.

For a usable credential, Authd calls:

```text
identityd.RevokeSession(credential)
```

A missing, duplicate, or malformed cookie requires no call. Successful,
already-revoked, unknown, missing, and malformed credentials all clear both
Authd cookies and return `303` to the validated return target. Identityd
`UNAUTHENTICATED` is therefore already logged out. Transport, admission,
deadline, or availability failure is `503`; Authd retains the Session cookie
and does not redirect so revocation can be retried.

## Cookies and state

The complete cookie inventory is:

| Cookie | Value and attributes |
| --- | --- |
| `__Host-ctlflow-auth-state` | Independent random 32-byte nonce; unpadded base64url; `Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600` |
| `__Host-ctlflow-session` | Identityd's exact 32-byte credential; unpadded base64url; `Path=/; Secure; HttpOnly; SameSite=Lax`; Identityd expiry |

Neither cookie has `Domain`. Session `Expires` and `Max-Age` use Identityd's
absolute expiry and never exceed 30 days. Clearing repeats the security
attributes with `Max-Age=0` and the Unix-epoch HTTP date.

In-flight state is process-local, at most 16 KiB per attempt, at most 4,096
live attempts per process, one-time, and exactly ten minutes. It contains only
the two digests, selected pair, return target, adapter identity and correlation
material, and times. It is never durable or placed in a cookie, log, telemetry,
or audit payload. Restart loses it and callbacks fail closed. Replicas use
state-cookie affinity for the ten-minute window; no shared state is implied.

## Deployed dependencies

Authd reads one Configd-owned, purpose-bound generation at startup:

```text
non-secret manifest: public origin and at most 4,096 Tenant/provider entries
secret file:          only provider credentials referenced by that manifest
```

Each entry selects one installed adapter and one purpose-bound Egressd endpoint
whose policy fixes the admitted external provider traffic. Both files are
read-only, process-private, disjoint, and at most 4 MiB. Missing, malformed,
oversized, duplicate, dangling, or incompatible material fails startup and
readiness. Changes replace the process; Authd has no Configd call, watch,
reload, discovery, or fallback.

The Egressd endpoint is a deployed proxy binding, not an Egressd
administration API or generic caller-selected proxy. Authd can use only the
entry selected before callback consumption. Each callback admits at most two
provider back-channel exchanges, each with a five-second deadline and a
256-KiB response bound.

Authd's only kernel RPCs are `Identityd.CreateSession` and
`Identityd.RevokeSession`. They use the established [private
transport](../contracts/#private-transport): private TLS, Authd's bound
Kubernetes workload bearer, finite deadline and cancellation, and W3C trace
context. They carry no invocation JWT. Authd uses one pooled Identityd channel,
a three-second per-call deadline bounded by the public request, and no
automatic retry.

Begin has a two-second deadline, Callback 15 seconds, and Logout five seconds.
Browser disconnect, deadline, and shutdown cancellation propagate to Egressd
and Identityd.

## Bounds and errors

Headers are at most 16 KiB, cookies 8 KiB, either form body 4 KiB, and the
callback request target 16 KiB with at most 32 query fields. A process admits
at most 128 public requests and 32 consumed callbacks concurrently. Begin and
Logout token buckets have capacity 20 and refill 120 requests per minute;
Callback has capacity 40 and refill 240 per minute. There is no unbounded
queue, buffer, state collection, retry, or task.

| Condition | Result |
| --- | --- |
| Unknown path; wrong method | `404`; `405` with the declared method in `Allow` |
| Malformed field, selection, return target, state, or callback | `400` |
| Provider or Identityd authentication rejection | `401` |
| Origin or authority failure | `403` |
| Body; target; media type; headers or cookies | `413`; `414`; `415`; `431` |
| Rate, concurrency, or state capacity | `429` with bounded `Retry-After` |
| Egressd, provider, projection, Identityd, or deadline unavailable | `503` |
| Unexpected invariant failure | `500` |

Raw provider, proxy, certificate, token, gRPC, network, parser, configuration,
and stack diagnostics never cross the public boundary. Logout alone maps
RevokeSession `UNAUTHENTICATED` to successful already-logged-out behavior.

## Telemetry and verification

The stable operations are `authd.http.begin`, `authd.http.callback`, and
`authd.http.logout`. Routes extract W3C trace context only for correlation and
inject it into Egressd and Identityd calls. Egressd controls any external trace
propagation under the shared telemetry contract.

Bounded traces, metrics, and logs contain only route, method, status, closed
outcome, dependency class, latency, and saturation. They exclude selected IDs,
subjects, return targets, fields, bodies, cookies, state, credentials, secrets,
provider payloads, and raw exceptions. Collector failure is bounded and does
not change behavior. Authd has no Auditd call; Identityd audits actual Session
creation and revocation.

Canonical evidence uses the shipping public listener, real Identityd over the
production bearer-authenticated private channel, the mounted Configd-shaped
files, a real purpose-bound Egressd endpoint, and a separately controlled
external provider process. It proves the exact three-route inventory,
selection, return targets, Origin and callback CSRF defenses, state lifecycle,
cookies, provider mediation without direct egress, both Identityd mappings,
all errors and bounds, deadlines and cancellation, telemetry redaction and
Collector outage, invalid projection readiness, and restart with no durable
Authd state. Test controls are separately bound and create no production
route, provider catalog, Egressd API, or weaker transport.

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

`identityd` owns accounts, external identity links, Sessions, and invocation
identity. Authd owns the semantics and validation of its provider protocol
settings. Execd supplies Authd's process-private configuration and secret
projections from generic Configd custody; Configd does not interpret OIDC and
no Authd-to-Configd operation exists. `authd` may hold only bounded in-flight
protocol state. It cannot create, modify, infer, or cache an identity record
as an independent authority.

The checked `services/authd/api/http/v1/openapi.yaml` is the authoritative
request, response, status, redirect, and cookie contract. Its manifest and
verifier reject route, method, operation, media-type, status, or content drift.

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
For a wrong-method `HEAD` request, the status and headers are identical to the
standard error response, while HTTP wire semantics omit the representation
body.

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
cookie, creates one random state handle, independent browser-binding nonce, and
independent 32-byte PKCE verifier, and sets the state cookie. The verifier is
encoded as 43-character unpadded base64url and stored with the two digests,
selected pair, return target, and ten-minute expiry.

The sole production adapter is OIDC Authorization Code with PKCE S256. The
projected authorization endpoint has no query or fragment. Authd appends
exactly these UTF-8 form-encoded query parameters in this order:

```text
response_type=code
client_id=<projected client_id>
redirect_uri=<public-origin>/auth/v1/callback
scope=openid
state=<state handle>
code_challenge=BASE64URL(SHA-256(ASCII(PKCE verifier)))
code_challenge_method=S256
```

There is no other authorization parameter and no `plain` PKCE fallback. Authd
makes no provider request during Begin. It returns `303` to the resulting
HTTPS URL, which is at most 4,096 bytes. Unknown selection is `400`; an invalid
selected configuration is `503`.

## Callback

`GET /auth/v1/callback` accepts no body and exactly one of these query shapes:

```text
state + code
state + error [+ error_description]
```

`state` is exactly one 43-character unpadded-base64url value. `code` is one
non-empty OAuth visible-ASCII value of at most 2,048 bytes. `error` is one
OAuth NQSCHAR value of at most 64 bytes. `error_description`, admitted only
with `error`, is one NQSCHAR value of at most 256 bytes and is discarded
without logging. Duplicate, empty, mixed-result, or other fields, including
`error_uri`, are `400`; configuration cannot add a callback field.

Authd requires a live state-handle digest and the independent state-cookie
nonce digest, compares them in constant time, and atomically consumes the
attempt before provider validation. Missing, malformed, expired, replayed, or
mismatched state is the same `400`.

A valid provider `error` is `401`, clears the consumed state cookie, and makes
no Egressd or Identityd call. For `code`, Authd makes at most two back-channel
calls through the selected purpose-bound Egressd binding and never opens a
direct provider connection; the successful path makes exactly two.

The first call is `POST` to the projected token endpoint. It uses
`application/x-www-form-urlencoded`, `Accept: application/json`, and
`client_secret_basic`. The Basic value is standard Base64 of the independently
form-encoded client ID and client secret joined by `:`, and the body contains
exactly:

```text
grant_type=authorization_code
code=<callback code>
redirect_uri=<public-origin>/auth/v1/callback
code_verifier=<stored PKCE verifier>
```

Success requires HTTP `200`, `Content-Type: application/json` with only an
optional UTF-8 charset, and a strict UTF-8 JSON object containing one Bearer
`access_token` of at most 8,192 ASCII characters, one `token_type` equal to
`Bearer` case-insensitively, and one compact `id_token` of at most 16,384
ASCII characters. The access token must have the RFC 6750 `b64token` shape.
Duplicate members, invalid media, or invalid required values are rejected.
Unrecognized token members are ignored without materialization; Authd never
requests, stores, returns, or uses a refresh token.

The ID token must be a three-segment JWS whose protected header and claims are
strict JSON objects with no duplicate member names. The header contains
`alg=RS256`, a `kid` selecting exactly one projected key, and optional
`typ=JWT`; other protected fields are rejected. Authd verifies the RS256
signature and then requires:

- `iss` exactly equal to the projected issuer;
- `aud` equal to the projected client ID, either directly or as its sole array
  member, with any present `azp` also equal to that client ID;
- integer `exp` later than current time minus 60 seconds and integer `iat` no
  later than current time plus 60 seconds and no earlier than the attempt
  creation time minus 60 seconds;
- optional integer `nbf` no later than current time plus that skew;
- one case-sensitive `sub` of one to 255 ASCII characters; and
- any present `at_hash` equal to unpadded base64url of the leftmost 128 bits of
  SHA-256 over the ASCII access token.

Other ID-token claims are ignored without materialization.

The second call is `GET` to the projected UserInfo endpoint with no body,
`Accept: application/json`, and the exact access token in
`Authorization: Bearer`. Success requires HTTP `200`,
`Content-Type: application/json` with only an optional UTF-8 charset, and a
strict UTF-8 JSON object with one case-sensitive `sub` of one to 255 ASCII
characters. Duplicate members and signed or encrypted UserInfo responses are
rejected. Other claims are ignored without materialization. The UserInfo `sub`
must exactly match the validated ID-token `sub`; only that value becomes the
provider subject.

Egressd owns exact external destination, TLS, redirect, header, and body
enforcement but does not interpret OIDC. A provider rejection, token or
UserInfo rejection, invalid protocol result, signature or claim failure, or
subject mismatch is the same `401`.

After validation, Authd calls:

```text
identityd.CreateSession(tenant_id, provider_id, provider_subject)
```

Tenant and provider come only from consumed state; Authd never supplies an
account ID. Success sets the Session cookie, clears the matched state cookie,
and returns `303` to the stored return target. Identityd `UNAUTHENTICATED` is
also `401`. A consumed attempt clears its state cookie on failure.

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
the two digests, selected pair, return target, PKCE verifier, and times. It is
never durable or placed in a cookie, log, telemetry, or audit payload. The
shipping deployment has one replica. Restart loses its in-flight state and
callbacks fail closed; there is no shared-state or affinity path.

## Deployed dependencies

Authd reads one Configd-owned, purpose-bound generation at startup. Both files
are strict UTF-8 JSON objects with integer `schema_version` equal to `1`;
duplicate or unknown member names are invalid. The non-secret document
contains exactly:

```text
schema_version
public_origin
providers
```

`providers` is an array containing one to 4,096 entries. Each entry contains
exactly:

```text
tenant_id
provider_id
issuer
authorization_endpoint
token_endpoint
userinfo_endpoint
client_id
credential_ref
egress_binding
verification_keys
```

The three endpoints and issuer are absolute ASCII HTTPS URIs of at most 2,048
bytes with no userinfo, query, or fragment. Client IDs are one to 256 OAuth
visible-ASCII bytes. Credential references use the canonical
one-to-64-character identifier shape. An Egressd binding name is a
one-to-63-character lower-case Kubernetes DNS label and selects the
same-Namespace purpose-bound HTTP Service on port `8081`.
`verification_keys` contains one to eight entries with unique `kid`; each
contains exactly `kid`, `kty`, `use`, `alg`, `n`, and `e`. `kid` is one to 128
visible-ASCII bytes, `kty` is `RSA`, `use` is `sig`, `alg` is `RS256`, and
unpadded-base64url `n` and `e` decode to a 2,048-to-4,096-bit modulus and an
odd exponent from 3 through 4,294,967,295.

Each entry asserts one static provider registration for the exact callback
URI, Authorization Code response type, `openid` scope, PKCE S256,
`client_secret_basic`, RS256 ID tokens, and plain JSON UserInfo response.

The disjoint secret document contains exactly `schema_version` and
`credentials`. `credentials` is an array with exactly one entry per provider;
each contains exactly `credential_ref` and a one-to-2,048-byte OAuth
visible-ASCII `client_secret`. Tenant/provider pairs and credential references
are unique; every provider resolves one credential and there are no unused
credentials.

Both files are read-only, process-private, disjoint, and at most 4 MiB.
Missing, malformed, oversized, duplicate, dangling, unused, or incompatible
material fails startup and readiness. Changes, including verification-key
rotation, replace the process. Authd has no Configd call, watch, reload,
discovery, dynamic registration, JWKS fetch, adapter catalog, or fallback.

The Egressd endpoint is a deployed proxy binding, not an Egressd
administration API or generic caller-selected proxy. Authd can use only the
entry selected before callback consumption. The binding admits only the
projected token `POST` and, only after its successful validation, the projected
UserInfo `GET`, including the exact OIDC headers and bounds above. Each call
has at most 16 KiB of request headers, the token form body is at most 8 KiB,
and the UserInfo request has no body. Each call has a five-second deadline and
a 256-KiB response bound. There is no redirect, retry, discovery, JWKS,
introspection, revocation, or third provider call.

Each request authenticates Authd to the binding with
`Proxy-Authorization: Bearer <bound Authd workload token>`. Egressd consumes
that header. The OIDC `Authorization` header remains independent upstream
protocol data. The same process-private workload-token projection authenticates
Authd's Egressd and Identityd calls; it is not provider configuration and never
crosses either dependency boundary. Authd cannot name or override an Egressd
origin or rule. Egressd workload-authentication rejection (`407`) or admission
exhaustion (`429`) is dependency unavailability and maps to public `503`, never
to provider rejection.

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
callback request target 16 KiB with at most three query fields. A process admits
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
authorization codes, PKCE verifiers, client secrets, access or ID tokens,
provider error detail, provider payloads, and raw exceptions. Collector
failure is bounded and does not change behavior. Authd has no Auditd call;
Identityd audits actual Session creation and revocation.

Canonical evidence uses the shipping public listener, real Identityd over the
production bearer-authenticated private channel, the mounted Configd-shaped
files, a real purpose-bound Egressd endpoint, and a separately controlled
OIDC process. It proves the exact three-route inventory, strict projection,
authorization URL and PKCE, both callback branches, token and UserInfo
requests, RS256 and claim validation, exact subject match, the zero-to-two
provider-call bound and exact two-call success path, selection, return targets,
Origin and callback CSRF defenses, state lifecycle, cookies, mediation without
direct egress, both Identityd mappings, all errors and bounds, deadlines and
cancellation, telemetry redaction and Collector outage, invalid projection
readiness, and restart with no durable Authd state. Test controls are
separately bound and create no production route, discovery, provider catalog,
adapter framework, Egressd API, or weaker transport.

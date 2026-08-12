---
title: authd API
description: Public browser authentication routes and OIDC flow.
weight: 80
---

`authd` owns the public browser authentication protocol boundary. Its checked
contract is
[`services/authd/api/http/v1/openapi.yaml`](https://github.com/control-flow-project/ctlflow/blob/main/services/authd/api/http/v1/openapi.yaml).
See the [authd service specification](../../authd/) for OIDC validation,
cookie, dependency, and failure rules.

## Route inventory

| Method and path | Input | Success | Purpose |
| --- | --- | --- | --- |
| `POST /auth/v1/begin` | `Origin`, optional state cookie, strict form body | `303` provider redirect | Starts one OIDC Authorization Code with PKCE attempt. |
| `GET /auth/v1/callback` | exact callback query and required state cookie | `303` same-origin redirect | Consumes the provider result and creates a Session. |
| `POST /auth/v1/logout` | `Origin`, optional cookies, optional strict form body | `303` same-origin redirect | Revokes the Session when present and clears browser cookies. |

Authd has no other public method or route and no private inbound gRPC API.
Undeclared paths return `404`; another method on a declared path returns
`405`. `HEAD` and `OPTIONS` are not aliases.

## Begin authentication

Headers:

| Header | Requirement |
| --- | --- |
| `Origin` | Exact projected canonical HTTPS public origin |
| `Cookie` | At most one optional `__Host-ctlflow-auth-state` value |
| `Content-Type` | `application/x-www-form-urlencoded`, with only an optional UTF-8 charset |

Form fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `tenant_id` | yes | Selected Tenant |
| `provider_id` | yes | Selected projected provider |
| `workspace_id` | no | Workspace whose exact provider admission is required |
| `return_to` | no | Same-origin path and optional query; defaults to `/` |

Example:

```bash
curl -i \
  -X POST \
  -H 'Origin: https://northwind.example.com' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'tenant_id=northwind&workspace_id=atlas&provider_id=workforce&return_to=%2Fatlas%2F' \
  https://northwind.example.com/auth/v1/begin
```

Successful response:

```text
HTTP/1.1 303 See Other
Location: https://idp.example.com/authorize?...
Set-Cookie: __Host-ctlflow-auth-state=<opaque>; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600
Cache-Control: no-store
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'
```

Authd requires an active Tenant and matching Identityd provider registration.
When a Workspace is selected, it also requires an active same-Tenant Workspace
and an exact current admission for that provider. It fixes
the authorization endpoint and client configuration from the matching
projected provider entry. It creates a PKCE S256 verifier and one browser-bound
attempt. The request cannot supply an authorization endpoint, client ID,
redirect URI, scope, or PKCE method.

## Provider callback

The callback has no body. Its query has exactly one of these shapes:

```text
state=<opaque>&code=<authorization-code>
```

```text
state=<opaque>&error=<provider-error>[&error_description=<bounded-detail>]
```

Each field occurs once. `error_uri`, duplicate values, a mixed `code` and
`error`, or additional fields are invalid.

Example provider redirect:

```http
GET /auth/v1/callback?state=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&code=provider-code HTTP/1.1
Host: northwind.example.com
Cookie: __Host-ctlflow-auth-state=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

On the code branch, Authd:

```text
consume matching browser-bound attempt
  -> revalidate Tenantd Tenant and optional Workspace lifecycle
  -> revalidate Identityd provider and optional Workspace admission
  -> purpose-bound Egressd POST to exact token endpoint
  -> validate Bearer token response and RS256 ID token
  -> purpose-bound Egressd GET to exact UserInfo endpoint
  -> require exact ID-token/UserInfo subject match
  -> identityd.CreateSession(tenant, provider, provider subject)
  -> set opaque Session cookie
  -> redirect to stored same-origin return target
```

Successful response:

```text
HTTP/1.1 303 See Other
Location: /atlas/
Set-Cookie: __Host-ctlflow-session=<opaque>; Path=/; Secure; HttpOnly; SameSite=Lax
Set-Cookie: __Host-ctlflow-auth-state=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT
Cache-Control: no-store
```

The Session cookie contains Identityd's opaque 32-byte credential. It is not
a JWT and is never sent to the identity provider.

A valid provider error consumes the attempt and returns `401` without an
Egressd or Identityd call. A malformed or replayed state fails without
selecting another Tenant, provider, or return target.

## Logout

The optional form contains only `return_to`. Missing or malformed Session
cookies have already-logged-out semantics.

```bash
curl -i \
  -X POST \
  -H 'Origin: https://northwind.example.com' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Cookie: __Host-ctlflow-session=<opaque>' \
  --data 'return_to=%2F' \
  https://northwind.example.com/auth/v1/logout
```

When a valid Session cookie exists, Authd calls
`identityd.RevokeSession`. It then clears both Authd cookies and redirects to
the validated same-origin target. If Identityd is unavailable, Authd returns
`503` without clearing the Session cookie so the caller can retry.

## Statuses

| Route | Declared statuses |
| --- | --- |
| `POST /auth/v1/begin` | `303`, `400`, `403`, `413`, `414`, `415`, `429`, `431`, `500`, `503` |
| `GET /auth/v1/callback` | `303`, `400`, `401`, `413`, `414`, `429`, `431`, `500`, `503` |
| `POST /auth/v1/logout` | `303`, `400`, `403`, `413`, `414`, `415`, `429`, `431`, `500`, `503` |

Error responses use the fixed body:

```text
Request could not be completed.
```

They do not disclose provider, credential, account, Tenant, dependency, or
validation details. Every response carries the declared no-store and browser
hardening headers.

## Bounds

| Input | Bound |
| --- | ---: |
| Request headers | 16,384 bytes |
| Cookies | 8,192 bytes |
| Begin or logout form body | 4,096 bytes |
| Callback request target | 16,384 bytes |
| Return target | 2,048 characters |
| Authorization code | 2,048 visible ASCII characters |
| Authentication attempt | 10 minutes |

Rate limiting is finite and returns `429` with a bounded `Retry-After`.

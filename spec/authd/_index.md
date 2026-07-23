---
title: authd
weight: 45
---

`authd` is the public authentication protocol boundary. It translates untrusted browser and
identity-provider HTTP into private `identityd` operations and owns no identity record.

## Activities

- Resolve the exact Tenant root and then any Workspace return segment through `tenantd`.
- Present the Tenant's admitted login methods without disclosing whether a User exists.
- Start an admitted login through private `identityd`.
- Receive and validate bounded login callbacks, then submit them to `identityd`.
- Set or clear opaque secure browser-session cookies returned by `identityd`.
- Enforce origin, CSRF, replay, callback, redirect, body, time, and rate limits.
- Remove caller-supplied protected identity and CtlFlow context headers.
- Create or continue validated W3C trace context and emit bounded authentication telemetry.
- Emit attributable authentication decision evidence without recording credentials or provider
  payloads.

## Login flow

```text
 browser
    |
    | public authentication HTTP
    v
  authd
    +---- resolve external address ----------> tenantd
    +---- begin or complete login -----------> identityd
                                                   |
                                                   +---- admitted provider HTTP -> egressd
                                                   +---- identity and Membership resolution
                                                   +---- opaque Session creation
    |
    | secure opaque cookie and validated return
    v
 browser
```

Login is Tenant-scoped. A Workspace may narrow the Tenant's enabled provider set and may supply the
validated return context, but it cannot create identity standing or widen admission.

`authd` never accepts a caller-provided User, Membership, Tenant, Workspace, provider subject, or
return URL as an authenticated fact. `tenantd` and `identityd` derive those facts from canonical
addresses, one-use login state, provider results, and current records.

## Public operations

| Operation family | Purpose |
| --- | --- |
| Options | Return admitted login methods for one resolved Tenant and optional Workspace |
| Begin | Start one short-lived, one-use login transaction |
| Callback | Complete one exact provider transaction |
| Logout | Revoke the current Session through `identityd` and clear its cookie |

The public surface is HTTP because browser redirects, cookies, and identity-provider callbacks are
HTTP protocols. `authd` has no public administrative, User, Session, token-issuance, or kernel RPC.
Its liveness and readiness endpoints are operational and are not a second domain API.

Kubernetes ingress may route `authd` and `edged` on the same Tenant origin so `authd` can set the
Session cookie later consumed by `edged`. The cookie is host-only, Secure, HttpOnly, and scoped to
the exact resolved Tenant or Workspace address root; no caller controls its name, path, domain, or
SameSite policy. Logout clears the cookie with the same canonical attributes.

The authentication route occupies a fixed structural segment beneath that address root and cannot
compete with a Tenant, Workspace, App, or other user-controlled ID.

## Boundaries

- `authd` is public-facing; `identityd` is internal-only.
- `authd` presents its bound Kubernetes ServiceAccount token on every private kernel call.
- `authd` owns no User, Membership, identity link, SSO provider, admission policy, Session, signing
  key, virtual principal, or runtime principal.
- Provider non-secret configuration and login state remain under `identityd`; provider secret
  material remains under `configd`.
- The browser receives only an opaque Session cookie. It never receives an internal invocation
  token or Kubernetes workload credential.
- `authd` does not expose or proxy an `identityd` operation generically.
- Authentication telemetry is operational and cannot replace `auditd` evidence.

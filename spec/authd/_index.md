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

## Public HTTP contract

The authentication surface occupies the fixed path below the canonical Tenant root:

```text
<Tenant root>/_ctlflow/auth/v1/options
<Tenant root>/_ctlflow/auth/v1/begin/<provider-id>
<Tenant root>/_ctlflow/auth/v1/callback/<provider-id>
<Tenant root>/_ctlflow/auth/v1/logout
```

The fixed prefix and provider-ID position cannot compete with Tenant, Workspace, App, or another
user-controlled path. Requests made from a Workspace carry a server-validated Workspace return
target; callback URLs remain at the Tenant root.

| Method and operation | Input | Result |
| --- | --- | --- |
| `GET` Options | Canonical Tenant address and optional validated Workspace return | Bounded enabled provider IDs, display metadata, and begin URLs |
| `POST` Begin | Provider ID, same-origin CSRF proof, optional validated Workspace return | `303` to the exact provider authorization URL and one-use transaction cookie |
| `GET` or `POST` Callback | Provider callback fields and one-use transaction state | Secure Session cookie and `303` to the stored canonical return target |
| `POST` Logout | Current Session cookie and same-origin CSRF proof | Session revocation, matching cookie deletion, and `204` |

The public surface is HTTP because browser redirects, cookies, and identity-provider callbacks are
HTTP protocols. `authd` has no public administrative, User, Session, token-issuance, or kernel RPC.
Its liveness and readiness endpoints are operational and are not a second domain API.

Kubernetes ingress may route `authd` and `edged` on the same Tenant origin so `authd` can set the
Session cookie later consumed by `edged`. The cookie is host-only, Secure, HttpOnly, and scoped to
the canonical Tenant root even when login returns to a Workspace; no caller controls its name, path,
domain, or SameSite policy. One Tenant login can therefore serve its admitted Workspace paths
without exposing the cookie outside that Tenant root. Logout clears the cookie with the same
canonical attributes.

Options never vary by whether an account exists. Begin, callback, and logout accept only declared
content types and finite bodies. A malformed, expired, replayed, cross-origin, cross-Tenant, or
provider-mismatched transaction receives one generic authentication failure and creates no Session.
Provider errors and account existence are not reflected into public detail. Rate limiting is keyed
from bounded transport and transaction facts and cannot be used to enumerate Users.

## Callers and dependencies

| Callee | Operation used | Purpose |
| --- | --- | --- |
| `tenantd` | ResolveTenant, ResolveWorkspace | Resolve the Tenant and validate an optional Workspace return |
| `identityd` | ResolveLoginOptions | Return the current admitted provider set |
| `identityd` | BeginLogin | Create one-use provider transaction state and authorization request |
| `identityd` | CompleteLogin | Validate provider result and create one opaque Session |
| `identityd` | RevokeSession | Revoke the exact cookie Session during logout |
| `auditd` | RecordAuditBatch | Deliver required authentication decision evidence before public success |

`authd` presents its own bound Kubernetes workload token on every private call and propagates valid
trace context. It never calls an identity provider directly; `identityd` uses the admitted
`egressd` binding.

## Verification

Canonical evidence covers every HTTP method and route, Tenant-root and Workspace-return login,
provider narrowing, generic account-nondisclosing responses, one-use state, replay, origin and CSRF
failure, callback methods and body limits, cookie attributes and deletion, Session revocation,
rate limits, malformed trace replacement, downstream outage, cancellation, telemetry redaction,
and audit delivery. Browser tests prove that a Tenant Session is usable at an admitted Workspace
path and is not sent outside its canonical Tenant root.

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
- A Workspace return changes neither Session ownership nor cookie scope.
- Authentication telemetry is operational and cannot replace `auditd` evidence.

---
title: authd
weight: 45
---

`authd` is the public authentication-protocol boundary. It accepts only
authentication HTTP traffic and owns no durable domain record.

## Boundary

`authd` is responsible for:

- public authentication request and callback transport;
- browser cookie, origin, CSRF, return-target, and protocol handling;
- bounded abuse controls at the public boundary; and
- mapping public failures to non-disclosing HTTP responses.

`identityd` owns accounts, external identity links, Sessions, and invocation
identity. `configd` owns provider-protocol configuration and secret custody.
`authd` may hold only bounded in-flight protocol state. It cannot create,
modify, infer, or cache an identity record as an independent authority.

## Contract

Only routes declared in an `authd`-owned, versioned HTTP contract exist.
This ownership page does not imply login, callback, logout, discovery, or
administrative routes and does not define an alternate private API.

The public and private surfaces remain separate:

```text
browser -> authd public HTTP

authd -> identityd.CreateSession
authd -> identityd.RevokeSession
```

Any private dependency call uses authenticated workload transport, a finite
deadline, cancellation, and W3C trace context. Browser cookies and external
provider credentials never become private service credentials.

After validating an external provider result, Authd supplies Identityd only
the target Tenant, provider ID, and exact provider subject. It never supplies
an account ID. Identityd resolves the current link and returns a one-time
opaque Session credential for Authd to encode in an HttpOnly cookie.

For logout, Authd forwards the opaque credential to
`identityd.RevokeSession`. Authd never parses, signs, validates, or stores an
invocation JWT.

## Invariants

- `authd` owns no durable state; bounded in-flight protocol state ends with
  completion or finite expiry.
- It exposes no Tenant, User, Session, provider, or policy administration.
- It never accepts caller-supplied identity as an established User.
- It never places a private kernel RPC on its public listener.
- Authentication failures do not reveal whether a User or Membership exists.
- Required security evidence is delivered through the approved audit contract;
  telemetry is not authoritative evidence.

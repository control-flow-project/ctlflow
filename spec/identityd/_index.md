---
title: identityd
weight: 55
---

`identityd` owns Tenant accounts, authentication, and membership standing.

## Owns

| Record | Meaning |
| --- | --- |
| User | Human or service account belonging to one Tenant |
| Identity link | External provider subject bound to one human User |
| Membership | Tenant or Workspace standing with role `admin` or `member` |
| Session | Opaque human browser session |
| SSO provider | Tenant-owned identity provider configuration |
| Admission policy | Providers admitted at Tenant or Workspace entry |

It serves `identity.ctlflow.com/v1alpha1` as `users`, `identitylinks`, `memberships`, `sessions`,
`ssoproviders`, and `admissionpolicies`.

## Responsibilities

- Manage human and service accounts, Memberships, and external identity links.
- Manage Tenant SSO providers and Workspace narrowing of Tenant provider admission.
- Perform provider discovery and token exchange through the provider's approved `egressd`
  destination bindings; `identityd` opens no independent external connection.
- Start and complete browser login and issue opaque Tenant sessions.
- Validate and revoke sessions.
- Exchange a valid session for a short-lived backend credential representing the same Tenant
  principal to either the aggregated APIs or one admitted App endpoint.
- Validate those exchanged credentials for the Kubernetes authentication webhook.
- Expose current account and Membership standing to services that make domain decisions.

Login is Tenant-scoped even when initiated from a Workspace URL. The return target may be the
Workspace, but current Workspace Membership is still required. Service accounts cannot use SSO or
hold browser sessions.

An App-audience exchange validates the target App through `execd` and requires the User's current
Membership to reach the App Context. It authenticates the caller to that App; application-data
authorization still occurs at the resource operation.

Provider credentials use a write-only subresource and Kubernetes Secret custody. Provider records
contain only non-secret configuration, approved Egress Destination references, and binding
readiness. `egressd` applies the credential to provider calls; it is never exposed to the browser.

## Boundaries

`identityd` establishes who a caller is and where an account has standing. `tenantd` owns the
Tenant and Workspace tree. `policyd` decides application-data authority. `execd` owns the virtual
principals attached to accounts.

Infrastructure operator identity comes from Kubernetes and is never issued by `identityd`.

## Invariants

- A provider subject maps to at most one User in a Tenant.
- A User has at most one Membership for the same Tenant or Workspace scope.
- A Workspace admission policy may only narrow its Tenant's providers.
- Disabling a User invalidates its sessions, denies delegated runtime authority, and causes
  `execd` to stop attached workloads while the account remains disabled.
- Revoking a session prevents further exchange from it.
- Disabling an SSO provider blocks new login and invalidates sessions established through it.
- A tenant credential can represent only its authenticated Tenant principal and can never map to
  infrastructure-operator authority.

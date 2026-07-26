---
title: identityd
weight: 46
---

`identityd` is the private authority for accounts, current standing, Groups,
Sessions, and delegated identity. It has no public listener.

## Ownership

`identityd` owns:

- human and service Users;
- Tenant and Workspace Membership standing;
- non-nested Groups and direct Group membership;
- external identity links and SSO provider identity;
- opaque browser Sessions;
- virtual principals attached to existing accounts;
- concrete runtime principals; and
- invocation signing custody and public verification keys.

A Membership establishes standing only. It contains no Role, capability,
grant, or administrator flag. `policyd` alone owns management authority.

## Approved contract

The service-owned protobuf contract exposes exactly:

```text
GetInvocationVerificationKeys
ResolvePrincipal
ListPrincipalGroups
```

No other identityd operation exists in the contract. This page does not imply
User, Membership, Group, Session, provider, login, principal-lifecycle, or
credential-management methods.

### GetInvocationVerificationKeys

The empty request returns one to eight active or retiring RS256 public keys and
an absolute cache expiry. Each key has:

```text
key ID
algorithm
base64url modulus
base64url exponent
```

The expiry is after response time and no more than five minutes later. Empty,
duplicate, malformed, expired, or oversized responses are unavailable. The
operation never returns private or symmetric key material.

Receivers refresh on expiry or an unknown key ID. A known key in a current
cache may remain usable during an identityd outage.

### ResolvePrincipal

The request contains one canonical principal ID, target Tenant ID, and
optional target Workspace ID. Success returns:

```text
principal ID, kind, enabled state, revision
subject-account ID, enabled state, revision
current target Membership revision
```

For a human or service User, the subject account is that User. For a virtual
principal, it is the principal's one immutable attached account.

Success proves current standing at the exact target. An unknown principal,
missing standing, cross-Tenant target, or virtual principal outside its fence
is `NOT_FOUND`. Disabled principal or account state is returned as current
fact so `policyd` can return a normal deny.

### ListPrincipalGroups

The request uses the same principal and target selector plus page size and an
optional last Group ID. The response contains only current direct Group IDs in
ascending ordinal order and an optional next last ID.

Page size zero selects 50; admitted values are one through 100. The last ID is
untrusted keyset input and is not stored server state. Groups are not nested,
expanded across scopes, or interpreted as grants.

## Callers

Each operation admits an exact finite set of Kubernetes ServiceAccount
subjects. `tenantd` and `policyd` use
`GetInvocationVerificationKeys`. `policyd` uses `ResolvePrincipal` and
`ListPrincipalGroups` while evaluating one invocation.

Every call uses private TLS, an authenticated workload token, finite deadline,
cancellation, and W3C trace context. Principal fact calls also carry the same
invocation JWT being evaluated. A request field cannot replace its Actor.

## Errors

| gRPC status | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | A selector, page size, or continuation is malformed |
| `NOT_FOUND` | Current exact-target standing cannot be established |
| `UNAUTHENTICATED` | Workload or required invocation identity is invalid |
| `PERMISSION_DENIED` | The authenticated workload is not admitted |
| `UNAVAILABLE` | Required custody or identity state is unavailable or malformed |
| `CANCELLED` / `DEADLINE_EXCEEDED` | The operation did not complete |

## Identity invariants

- A virtual principal has one immutable attached human or service account.
- A virtual principal is not named by an App, trigger, schedule, event, or
  display name.
- The invocation JWT identifies subject account in `sub` and a distinct
  virtual Actor in `act.sub`.
- Actor and subject-account authority are intersected by `policyd`.
- Invocation tokens contain identity and fence facts, never Roles, grants,
  endpoints, or permission snapshots.
- Signing material never leaves `identityd`.
- Identity facts are not cached as authorization decisions.

## Verification

Canonical evidence covers exact caller admission, bounded key responses,
unknown-key refresh, current and missing standing, human/service/virtual
principal facts, disabled state, direct Group pagination, cross-target
concealment, dependency failure, cancellation, and redacted correlated
telemetry.

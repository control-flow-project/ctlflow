---
title: identityd
weight: 46
---

`identityd` is the private authority for current principal, attached-account,
Membership, direct-Group, external-identity-link, Session, and invocation
identity. It exposes only the gRPC contract in
`services/identityd/api/proto/v1/identityd.proto` and has no public listener.

## Approved ownership

The implemented contract owns:

- human and service account principals;
- virtual principals attached to one account;
- exact Tenant and Workspace Membership standing;
- non-nested Groups and direct principal-to-Group membership; and
- Tenant-scoped external identity links;
- opaque browser Sessions;
- invocation-signing custody; and
- active and retiring invocation public verification keys.

A Membership establishes standing only. A Group is a direct audience only.
Neither contains a Role, grant, capability, administrator flag, operation, or
access decision. `policyd` alone owns those policy concepts.

Account, Membership, Group, virtual-principal, external-identity-link, and key
lifecycle are installation-provisioned domain state in this contract. The only
domain mutations are Session creation and revocation. No account, Membership,
Group, principal, identity-link, provider-configuration, credential-management,
or key-lifecycle operation exists in the approved API.

## Records

### Principals

A principal contains:

```text
principal ID
kind
subject-account ID
enabled state
positive revision
optional virtual-principal Tenant fence
optional narrower virtual-principal Workspace fence
```

The complete principal kinds and canonical IDs are:

| Kind | Canonical ID |
| --- | --- |
| Human account | `user:<local-id>` |
| Service account | `service:<local-id>` |
| Virtual principal | `agent:<local-id>` |

The complete ID is at most 256 characters. A local ID is lower-case ASCII,
starts alphanumeric, and otherwise contains only alphanumeric characters,
`.`, `_`, or `-`.

For a human or service principal, the subject account is the principal itself
and no virtual-principal fence exists. A virtual principal has one immutable,
distinct human or service subject account and one immutable Tenant fence. It
may additionally have one immutable Workspace fence inside that Tenant.

Enabled state belongs independently to the principal and subject account. A
disabled value remains a current fact returned to `policyd`; Identityd does
not convert it into a policy decision.

### Memberships

A Tenant Membership contains:

```text
subject-account ID
Tenant ID
positive revision
```

A Workspace Membership contains:

```text
subject-account ID
Tenant ID
Workspace ID
positive revision
```

A Workspace Membership structurally requires the same account's Tenant
Membership. Presence is current standing; there is no second Membership state
or Role field.

Tenant and Workspace IDs use the same canonical identifier shape as Tenantd:
one to 64 lower-case ASCII characters, starting alphanumeric, with only
alphanumeric characters, `_`, or `-` thereafter.

For a Tenant target, `membership_revision` is the Tenant Membership revision.
For a Workspace target, Identityd requires both Memberships and returns the
Workspace Membership revision.

### Groups

A Group contains one globally unique Group ID and one exact target:

```text
Group ID
Tenant ID
optional Workspace ID
```

A direct Group membership relates one principal to one Group. Groups are not
nested. A Workspace query returns only direct Groups whose exact target is that
Workspace; it does not implicitly include Tenant-target Groups. Policyd queries
the virtual Actor and its subject account separately when both authority sets
are required.

Group IDs use the same one-to-64-character canonical identifier shape as
Tenant and Workspace IDs.

### Invocation verification keys

One verification-key record contains:

```text
key ID
RS256 algorithm
base64url RSA modulus
base64url RSA exponent
active or retiring state
positive revision
```

Key IDs are one to 128 visible ASCII characters. Decoded modulus material is
128 to 1,024 bytes and decoded exponent material is one to eight bytes. The
current set contains exactly one active key and zero through seven retiring
keys.

The active RS256 private key is supplied through a process-private file
projection. It must match the active public-key record. Private or symmetric
key material is never stored in Identityd persistence, returned by an API,
placed in an environment value, or exposed to another process.

### External identity links

An external identity link contains:

```text
Tenant ID
provider ID
provider subject
human account ID
positive revision
```

Provider IDs use the canonical one-to-64-character identifier shape. Provider
subjects are exact, case-sensitive, non-empty values of at most 512
characters. A provider identity maps to at most one human account inside one
Tenant. Service and virtual principals cannot be login targets.

Identityd owns the identity mapping. Authd owns public protocol validation and
supplies only a provider ID and provider subject that it has established from
that protocol. It never supplies an account ID. Provider protocol
configuration and secret custody are outside this contract.

### Sessions

A Session contains:

```text
opaque Session ID
human account ID
Tenant ID
SHA-256 credential digest
creation and finite expiry times
optional revocation time
positive revision
```

Identityd generates each Session ID and 256-bit credential using a
cryptographically secure random source. The raw credential is returned only
by `CreateSession`; Identityd persists only its digest. A Session is
Tenant-scoped. A later Workspace target is admitted only through the account's
current Workspace standing.

Revocation is terminal. Expiry is evaluated from the current time and does not
mutate the record. A configured Session lifetime is finite and no greater than
30 days.

## Standing and fences

Identityd establishes current facts at one requested target:

```text
Tenant target:
  matching Tenant Membership

Workspace target:
  matching Tenant Membership
  AND matching Workspace Membership
```

For a virtual principal, the target must additionally be inside its immutable
fence:

```text
Tenant target:
  requested Tenant == virtual Tenant fence

Workspace target:
  requested Tenant == virtual Tenant fence
  AND virtual Workspace fence is absent or equals requested Workspace
```

An invocation Workspace fence permits its parent Tenant target and only that
Workspace as a Workspace target. An invocation Tenant fence permits that
Tenant and any Workspace target inside it.

Unknown records, missing standing, a mismatched parent, or a target outside
either fence are concealed as `NOT_FOUND`.

## API

The service has exactly these operations:

| Operation | Input | Result |
| --- | --- | --- |
| `GetInvocationVerificationKeys` | Empty request | Bounded current public key set and cache expiry |
| `ResolvePrincipal` | Principal ID, Tenant ID, optional Workspace ID | Current principal, account, and Membership facts |
| `ListPrincipalGroups` | Same selector, page size, optional last Group ID | Bounded direct-Group ID page |
| `CreateSession` | Tenant ID, provider ID, provider subject | New Session ID, one-time opaque credential, and expiry |
| `ExchangeSession` | Opaque Session credential and exact target | Short-lived invocation JWT and expiry |
| `RevokeSession` | Opaque Session credential | Empty success |
| `IssueRunInvocation` | Actor principal ID, exact target, Run ID | Short-lived invocation JWT and expiry |

No other Identityd domain operation exists.

### GetInvocationVerificationKeys

The result contains the one active and every retiring verification key in
ascending ordinal key-ID order. The set must contain one through eight keys;
Identityd does not truncate an oversized set. The absolute cache expiry is
strictly after response time and no more than five minutes later.

The request requires only the admitted kernel workload. Callers do not carry
an invocation JWT because this operation is the bootstrap path used to
validate an unknown invocation key. Invocation metadata grants no authority
to this operation.

Empty, duplicate, malformed, expired, or oversized source state is
`UNAVAILABLE`. The operation never returns private or symmetric key material.

Receivers refresh on expiry or an unknown key ID. A known key in a current
receiver cache may remain usable during an Identityd outage.

### ResolvePrincipal

The response contains:

```text
principal ID, kind, enabled state, revision
subject-account ID, enabled state, revision
current exact-target Membership revision
```

For a human or service principal, principal and subject-account facts come
from the same account record. For a virtual principal, the account facts come
from its immutable attached account.

The required invocation JWT is validated locally. The requested principal
must be the invocation Actor. For a direct human or service invocation,
`sub` is that Actor. For a virtual invocation, `act.sub` is that Actor and
`sub` must equal the virtual principal's current attached account.

Disabled principal or account state is returned as current fact. Unknown
identity, attachment mismatch, missing standing, and fence mismatch are
`NOT_FOUND`.

### ListPrincipalGroups

The request uses the same target selector plus page size and optional last
Group ID. The required invocation JWT is validated locally.

The requested principal must be either:

- the invocation Actor; or
- for a virtual invocation, that Actor's immutable subject account named by
  `sub`.

Identityd re-establishes the Actor attachment, target fence, and requested
principal's current standing before returning direct Group IDs.

Results use ascending ordinal Group-ID order and keyset pagination:

```text
group_id > after_group_id
```

A zero page size selects 50; admitted sizes are one through 100. Identityd
reads one extra row to determine whether another page exists and returns the
last emitted Group ID as `next_after_group_id` only when another page exists.

The continuation is untrusted input, not stored state. Pagination has no
cursor table, snapshot journal, expiry, or mutation invalidation.

### CreateSession

Authd calls `CreateSession` only after it has validated one external
authentication protocol result. Identityd resolves the exact Tenant, provider
ID, and provider subject through its current external identity link. It then
requires an enabled human account and current Tenant Membership.

Success creates one Session, returns its generated ID, returns the raw
32-byte credential exactly once, and returns the absolute expiry. The
credential, provider subject, and protocol material never appear in telemetry
or audit.

Unknown identity links, disabled accounts, and missing Tenant standing are
`UNAUTHENTICATED`. Identityd never accepts an account ID from Authd.

### ExchangeSession

Edged calls `ExchangeSession` with the exact 32-byte credential received in a
browser cookie and the resolved Tenant plus optional Workspace target.
Identityd hashes the credential, requires one unexpired and unrevoked Session,
requires its enabled human account, and re-establishes current standing at the
exact target. Session expiry is evaluated against the full current instant;
whole-second normalization applies only to the issued invocation timestamps.

Success returns an RS256 invocation JWT whose `sub` is the Session account,
whose target fence is the request target, and whose origin is the Session ID.
It has no `act.sub` or `run_id`. The absolute token expiry is returned
separately.

An unknown, malformed, expired, or revoked credential is `UNAUTHENTICATED`.
Missing target standing is concealed as `NOT_FOUND`.

### RevokeSession

Authd calls `RevokeSession` with the exact 32-byte Session credential. An
active Session is irreversibly revoked and its revision advances once.
Repeating revocation for the same Session succeeds without another mutation or
audit event. Concurrent revocations of the same Session converge on that same
single mutation and audit event. An unknown or malformed credential is
`UNAUTHENTICATED`; expiry does not prevent revocation.

### IssueRunInvocation

Execd calls `IssueRunInvocation` for one Run it owns. The request names the
Run's Actor principal, Run ID, Tenant, and optional Workspace. Execd cannot
name an attached account. Identityd resolves the Actor, derives any attached
account, requires both to be enabled, and re-establishes current standing and
the virtual-principal fence at the exact target.

Success returns an RS256 invocation JWT whose `sub` is the direct or attached
account, whose optional `act.sub` is the distinct virtual Actor, whose target
fence is the request target, and whose origin is the Run ID. It has no
`session_id`.

Unknown or disabled identity, missing standing, and a target outside the
virtual-principal fence are concealed as `NOT_FOUND`.

### Invocation signing

Every issued invocation uses the one current active key, the configured
installation issuer and internal audience, a unique token ID, and a maximum
lifetime of 60 seconds. `iat`, `nbf`, and `exp` are bounded from the current
time and use whole Unix-second precision. The separately returned absolute
expiry equals the JWT `exp` instant exactly. A token has exactly one Session
or Run origin and never contains a Role, grant, capability, permission
snapshot, Kubernetes identity, or nested Actor.

Before serving issuance, readiness proves that the projected private key is
valid RS256 material and matches the one active public-key record. Signing or
key-state failure is `UNAVAILABLE`.

## Admission and invocation identity

Every operation authenticates a bound Kubernetes ServiceAccount token and
admits an exact per-operation caller set.

The approved callers are:

| Operation | Caller |
| --- | --- |
| `GetInvocationVerificationKeys` | `SERVICE/svc_tenantd`, `SERVICE/svc_policyd` |
| `ResolvePrincipal` | `SERVICE/svc_policyd` |
| `ListPrincipalGroups` | `SERVICE/svc_policyd` |
| `CreateSession` | `SERVICE/svc_authd` |
| `ExchangeSession` | `SERVICE/svc_edged` |
| `RevokeSession` | `SERVICE/svc_authd` |
| `IssueRunInvocation` | `SERVICE/svc_execd` |

Installation configuration maps those canonical principals to exact
Kubernetes ServiceAccount subjects. Startup fails when an operation has an
empty caller set or a configured subject is malformed.

`GetInvocationVerificationKeys`, `CreateSession`, `ExchangeSession`,
`RevokeSession`, and `IssueRunInvocation` require workload authentication but
no existing invocation JWT.
`ResolvePrincipal` and `ListPrincipalGroups` additionally require the unchanged
invocation JWT being evaluated. Identityd validates its RS256
signature against current local active or retiring keys, issuer, internal
audience, subject, optional single Actor, Tenant and optional Workspace fence,
origin, unique token ID, and bounded times. Its maximum lifetime is 60
seconds. A Session origin and Run origin are mutually exclusive.

A request field cannot replace the authenticated workload, invocation Actor,
attached account, or target fence. Every call uses private TLS, finite
deadline, cancellation, and W3C trace context.

## Errors

| gRPC status | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | A non-credential request field or bound is malformed |
| `NOT_FOUND` | Current exact-target identity, attachment, standing, or fence cannot be established |
| `UNAUTHENTICATED` | Workload, required invocation identity, external login identity, or Session credential is missing or invalid |
| `PERMISSION_DENIED` | The authenticated workload is not admitted for the operation |
| `UNAVAILABLE` | Persistence, signing, required key state, or obligatory audit delivery is unavailable, incompatible, or malformed |
| `CANCELLED` / `DEADLINE_EXCEEDED` | The operation did not complete |

Raw storage, token, key, and stack diagnostics never cross the boundary.

## Persistence and runtime

Identityd is durable. Its implementation reads only its own Knex-migrated
database. The logical schema contains principals, Tenant Memberships,
Workspace Memberships, Groups, direct Group memberships, and invocation
verification keys, external identity links, and Sessions.

Migrations contain structural tables, keys, foreign keys, uniqueness, bounds,
indexes, and representation checks only. No trigger, stored procedure,
database function, computed side effect, or SQL-resident behavior implements
attachment, standing, fencing, pagination, key admission, or identity rules.
Every decision is explicit implementation-language Domain code.

Successful `CreateSession` and an actual `RevokeSession` mutation create typed
Identityd Session audit evidence. Identityd calls
`auditd.RecordAuditBatch` directly after committing the Session mutation and
before returning success. It holds no database transaction during the call and
has no audit table, outbox, queue, retry journal, or fallback. Audit failure is
`UNAVAILABLE` and does not roll back the committed Session state.

The exact typed Session actions are `CREATED` and `REVOKED`. The event is
Tenant-partitioned and contains a canonical `evt_<32 lower-hex>` source event
ID, Session ID, human account principal ID, resulting positive Session
revision, action, authenticated Authd workload, occurrence time, and trace correlation. It
contains no credential, digest, provider identity, invocation token, signing
material, or generic operation string.

Session exchange, invocation issuance, fact reads, no-op revocation,
rejections, and dependency failures create no audit event.

Every operation emits bounded OpenTelemetry traces, metrics, and structured
logs. Telemetry excludes principal, account, Tenant, Workspace, Group, key,
token, and request-body values. Telemetry failure is bounded and does not
change an operation result.

The shipping process exposes standard health and readiness endpoints on a
separate probe-only listener. Readiness verifies the exact current migration
ledger and mapped schema. The private gRPC listener uses
installation-provisioned server TLS. Process-private files supply the server
identity, workload-validation material, active signing key, and Auditd client
identity. Operational endpoints are not Identityd domain operations.

## Verification

Canonical integration evidence covers:

- the exact seven-method descriptor and every documented status;
- exact per-operation workload admission;
- exactly one active and up to seven retiring keys, deterministic order,
  bounded expiry, private/public mismatch, malformed key state, and source
  outage;
- human, service, and virtual principal facts;
- immutable virtual attachment and Tenant/Workspace fences;
- direct and virtual invocation binding;
- Tenant standing and Workspace standing with required parent Membership;
- enabled and disabled principal and account facts;
- exact-scope direct Groups, keyset pagination, and concurrent inserts;
- external-identity resolution without caller-supplied account identity;
- one-time credential return, digest-only persistence, finite Session expiry,
  idempotent revocation, and restart persistence;
- Session-origin and Run-origin token claims, target fencing, distinct virtual
  Actor attachment, signing failure, and signature verification through the
  public-key operation;
- direct typed Auditd delivery for Session creation and actual revocation,
  no-op behavior, and Auditd failure;
- malformed selectors, hidden cross-target data, and corrupt stored facts;
- cancellation, deadline, restart, and incompatible schema;
- redacted correlated traces, metrics, logs, and database spans;
- bounded Collector outage; and
- NativeAOT publication, generated Entity Framework model selection,
  migration-image execution, and shipping Kubernetes assets.

There is no public listener, HTTP API, operator API, Role or grant API,
decision API, provider-protocol API, identity-management API, principal
mutation API, Group mutation API, key mutation API, watch, stream, cursor
table, audit outbox, or test-only production path in Identityd.

---
title: identityd API
description: Principal facts, Sessions, verification keys, and invocation issuance over gRPC.
weight: 20
---

`identityd` owns identity facts and short-lived invocation identity. Its
checked contract is
[`ctlflow.identity.v1.IdentityService`](https://github.com/control-flow-project/ctlflow/blob/main/services/identityd/api/proto/v1/identityd.proto).
All seven methods are unary gRPC. See the
[identityd service specification](../../identityd/) for standing, fence,
signing, and persistence rules.

## Service definition

```proto
service IdentityService {
  rpc GetInvocationVerificationKeys(GetInvocationVerificationKeysRequest)
      returns (GetInvocationVerificationKeysResponse);
  rpc ResolvePrincipal(ResolvePrincipalRequest)
      returns (ResolvePrincipalResponse);
  rpc ListPrincipalGroups(ListPrincipalGroupsRequest)
      returns (ListPrincipalGroupsResponse);
  rpc CreateSession(CreateSessionRequest) returns (CreateSessionResponse);
  rpc ExchangeSession(ExchangeSessionRequest) returns (IssueInvocationResponse);
  rpc RevokeSession(RevokeSessionRequest) returns (RevokeSessionResponse);
  rpc IssueRunInvocation(IssueRunInvocationRequest)
      returns (IssueInvocationResponse);
}
```

## Operation inventory

| Method | Request fields | Returns | Primary callers |
| --- | --- | --- | --- |
| `GetInvocationVerificationKeys` | none | active and retiring public keys, cache expiry | Any valid installation-issued bound workload token, including Execd-realized product workloads |
| `ResolvePrincipal` | `principal_id`, `tenant_id`, optional `workspace_id` | principal, attached account, standing revisions | `policyd` |
| `ListPrincipalGroups` | target selector, `page_size`, optional `after_group_id` | Group ID page | `policyd` |
| `CreateSession` | `tenant_id`, `provider_id`, `provider_subject` | opaque Session ID, credential, expiry | `authd` |
| `ExchangeSession` | Session credential and exact target | invocation JWT and expiry | `edged` |
| `RevokeSession` | Session credential | empty success | `authd` |
| `IssueRunInvocation` | `principal_id`, exact target, `run_id` | invocation JWT and expiry | `execd` |

Identityd does not expose a generic token mint, token introspection, Session
list, Session administration, Role list, grant list, or access-decision
method.

## Verification keys

`GetInvocationVerificationKeys` takes an empty message and returns a bounded
set of RS256 public keys:

```json
{
  "keys": [
    {
      "keyId": "invocation-2026-07",
      "algorithm": "VERIFICATION_KEY_ALGORITHM_RS256",
      "modulusBase64url": "uQ3...bounded-public-modulus",
      "exponentBase64url": "AQAB"
    }
  ],
  "expiresAt": "2026-07-29T09:00:00Z"
}
```

The response contains public verification material only. Callers cache it no
longer than `expires_at` and refresh on expiry or an unknown key ID. Identityd
never returns private signing material.

## Principal facts

`ResolvePrincipal` answers whether one principal and its attached account are
currently valid at one exact Tenant or Workspace target.

Request:

```json
{
  "principalId": "agent:personal-reviewer",
  "tenantId": "northwind",
  "workspaceId": "atlas"
}
```

Response:

```json
{
  "principalId": "agent:personal-reviewer",
  "principalKind": "PRINCIPAL_KIND_VIRTUAL",
  "principalEnabled": true,
  "principalRevision": "4",
  "subjectAccountId": "user:maya",
  "subjectAccountEnabled": true,
  "subjectAccountRevision": "12",
  "membershipRevision": "7"
}
```

The virtual principal is the Actor. `subject_account_id` is the existing
human or service account to which it is attached. Policyd evaluates both
identities; a virtual principal cannot gain authority that its attached
account lacks.

`PrincipalKind` is closed over:

```text
PRINCIPAL_KIND_HUMAN
PRINCIPAL_KIND_SERVICE
PRINCIPAL_KIND_VIRTUAL
```

## Group pagination

`ListPrincipalGroups` evaluates current direct groups at the same target used
for `ResolvePrincipal`.

```json
{
  "principalId": "agent:personal-reviewer",
  "tenantId": "northwind",
  "workspaceId": "atlas",
  "pageSize": 50
}
```

```json
{
  "groupIds": [
    "atlas_reviewers",
    "legal_automation"
  ]
}
```

When another page exists, `next_after_group_id` is the last emitted immutable
Group ID. Identityd returns identity facts only; it does not return grants or
an authorization decision.

## Browser Session flow

Authd creates a Session only after validating the provider result:

```json
{
  "tenantId": "northwind",
  "providerId": "workforce",
  "providerSubject": "00u7example"
}
```

```json
{
  "sessionId": "0123456789abcdef0123456789abcdef",
  "sessionCredential": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  "expiresAt": "2026-08-05T08:30:00Z"
}
```

The credential is an opaque 32-byte value. Authd stores it in the secure
browser cookie; it must not be logged or treated as an invocation JWT.

For an application request, Edged exchanges that credential for the target
fixed by its binding:

```json
{
  "sessionCredential": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  "tenantId": "northwind",
  "workspaceId": "atlas"
}
```

```json
{
  "invocationJwt": "<redacted short-lived JWT>",
  "expiresAt": "2026-07-29T08:35:00Z"
}
```

Identityd derives the account from the Session, validates current standing,
and signs the exact target fence. Edged cannot request a different account or
claim set.

Logout sends only the credential:

```json
{
  "sessionCredential": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
}
```

`RevokeSession` returns an empty message after an actual revocation. Repeating
revocation has the contract-defined idempotent result.

## Run invocation flow

Execd asks Identityd to issue a short-lived invocation for one admitted finite
Run:

```json
{
  "principalId": "agent:personal-reviewer",
  "tenantId": "northwind",
  "workspaceId": "atlas",
  "runId": "run_01k1b9cd"
}
```

Identityd resolves the Actor, derives the attached account when the Actor is
virtual, validates standing and the Run target, and returns the same
`IssueInvocationResponse` shape used by `ExchangeSession`. Execd cannot
supply an attached account, issuer, audience, key, permission, or arbitrary
claim.

## Outcomes

| Status | Identityd meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Invalid selector, credential shape, Run ID, or page input |
| `UNAUTHENTICATED` | Workload authentication, Session credential, or invocation proof is invalid |
| `PERMISSION_DENIED` | Authenticated caller is not admitted for the operation |
| `NOT_FOUND` | Principal, external link, Session, target standing, or Run Actor is not visible |
| `FAILED_PRECONDITION` | Current identity or target state forbids issuance |
| `UNAVAILABLE` | Persistence, signing custody, or required Auditd delivery is unavailable |
| `CANCELLED`, `DEADLINE_EXCEEDED` | The unary call did not complete |

Session creation and actual revocation are audited. Fact reads and invocation
issuance do not mutate identity records.

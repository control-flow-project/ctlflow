---
title: identityd
weight: 46
---

`identityd` is the private authority for who a caller or workload is, where an account has standing,
how browser Sessions are represented, and how delegated identity is bounded. It has no public
listener or browser protocol surface.

## Owns

| Record | Meaning |
| --- | --- |
| User | Human or service account at global or Tenant scope |
| Membership | User standing in one Tenant or Workspace |
| Group and Group member | Reusable Tenant- or Workspace-scoped audience |
| Identity link | External provider subject bound to one human User |
| SSO provider | Tenant identity-provider configuration |
| Admission policy | Tenant provider set or Workspace narrowing |
| Login transaction | Short-lived one-use provider and return binding |
| Session | Opaque browser session |
| Virtual principal | Stable delegated App-component or Job identity |
| Runtime principal | One concrete workload execution identity |

It serves the identity resources listed in [APIs](../apis/).

## Activities

- Create, update, enable, disable, list, and delete human and service Users.
- Manage Tenant and Workspace Memberships.
- Manage non-nested Groups and their direct principal members.
- Link external provider subjects to human Users.
- Configure Tenant SSO and Workspace admission narrowing.
- Resolve login methods and perform provider protocol decisions for public `authd`.
- Create, validate, list, and revoke opaque browser Sessions.
- Create a virtual principal attached to one existing enabled User admitted for the target
  Placement.
- Mint and retire a process-specific runtime principal for an admitted execution.
- Exchange one validated Session or admitted runtime context for a short-lived invocation JWT.
- Publish the current private verification-key set for local invocation validation.
- Mint process-bound proxy credentials for an exact dependency.
- Resolve canonical account, Group, Membership, and principal facts for authorized callers.

## Authentication flow

```text
 browser -> authd
              |
              +-- private call -> identityd
                                     +-- resolve Tenant login options
                                     +-- call admitted provider through egressd
                                     +-- validate provider response
                                     +-- resolve User and Membership
                                     +-- create opaque Tenant Session

 browser -> edged -> identityd validates Session
                    +-- derive subject account and Actor
                    +-- derive Tenant and optional Workspace
                    +-- issue short-lived internal invocation JWT
```

Provider non-secret configuration belongs to `identityd`. Provider secret material belongs to
`configd`. Discovery and token exchange use an explicitly bound `egressd` destination.

Login is Tenant-scoped. A Workspace may only narrow the Tenant provider set. Returning to a
Workspace never creates Membership.

Login state is short-lived, one-use, bound to the exact Tenant, provider, origin, and validated
return target. `authd` enforces secure-cookie, origin, CSRF, replay, callback, and bounded rate-limit
rules without revealing whether a User exists. `identityd` independently validates the one-use
state and provider result before creating a Session.

## Delegation flow

```text
 browser Session
   -> edged authenticates with its Kubernetes workload token
   -> identityd validates Session and current account standing
   -> identityd issues one short-lived invocation JWT
   -> edged and admitted downstream hops propagate that JWT
   -> each hop independently authenticates its immediate Kubernetes workload
```

An admitted Run runtime may also request an invocation JWT for its current virtual principal and
attached account. A Run-derived token records the Run and uses the Job's immutable Actor. No caller
may supply or replace the subject, Actor, attached account, Tenant, Workspace, Placement, or Run.

The invocation audience is the current CtlFlow installation's internal trust domain. It contains no
endpoint or permission snapshot and expires no later than 60 seconds after issuance. Immediate
caller identity comes from the independently validated Kubernetes workload token at each hop.

## Direct operations

| Operation | Admitted caller | Purpose |
| --- | --- | --- |
| ResolveLoginOptions | `authd` | Return the bounded enabled provider set for one Tenant and optional Workspace |
| BeginLogin | `authd` | Create one short-lived provider-bound login transaction |
| CompleteLogin | `authd` | Consume one transaction, validate the provider result, and create one Session |
| ExchangeSession | `edged` | Validate one opaque Session and issue its short-lived invocation JWT |
| RevokeSession | `authd`, admitted administrator | Revoke one exact Session |
| IssueRunInvocation | admitted runtime proxy | Issue a Run-derived invocation JWT from current runtime facts |
| GetInvocationVerificationKeys | admitted internal receiver | Return the active and retiring public verification keys with finite expiry |
| ResolvePrincipal | admitted kernel owner | Return bounded current facts for one exact User, Group, virtual, or runtime principal |
| ListPrincipalGroups | `policyd`, admitted administrator | Return one bounded page of Groups containing one exact principal |
| ListDirectGroupMembers | admitted administrator | Return one bounded page of current direct members |
| ValidateAttachedAccount | `pkgd`, `execd` | Prove that one enabled User may bound work at one exact Placement |
| CreateVirtualPrincipal | `pkgd`, `execd` | Create the stable principal for one exact App component or Job |
| DisableVirtualPrincipal | `pkgd`, `execd` | Block new use of an owned virtual principal |
| EnableVirtualPrincipal | `pkgd`, `execd` | Re-enable a non-retired owned virtual principal after revalidation |
| RetireVirtualPrincipal | `pkgd`, `execd` | Irreversibly retire an owned virtual principal |
| MintRuntimePrincipal | admitted runtime proxy | Create one process identity for an exact admitted execution generation |
| RetireRuntimePrincipal | `execd`, admitted runtime proxy | Retire one exact process identity |
| IssueProxyCredential | admitted runtime proxy | Issue one short-lived process-and-dependency-bound proxy credential |

### Authentication results

`ResolveLoginOptions` receives canonical Tenant ID and optional Workspace ID already resolved by
`authd`. It returns provider ID, bounded display metadata, protocol class, options revision, and a
cache expiry no later than 60 seconds. It never returns provider secrets, issuer discovery
documents, account matches, or admission reasons.

`BeginLogin` additionally receives the selected provider, exact public origin, and canonical
Tenant-local return target. It returns an opaque transaction credential, exact provider
authorization URL, required callback method, and expiry. The transaction stores all authoritative
Tenant, Workspace, provider, origin, return, nonce, verifier, and replay facts; callback input
cannot replace them.

`CompleteLogin` receives that transaction credential and the provider's bounded callback fields. It
consumes the transaction before external exchange, performs any admitted provider HTTP through
`egressd`, resolves an existing identity link, User, and current Membership, and returns an opaque
Session credential, Session expiry, and stored return target. It never creates a User, Membership,
or identity link implicitly.

`ExchangeSession` receives the opaque Session credential plus the resolved request Tenant and
optional Workspace. It returns the canonical subject account, Actor, Tenant, optional Workspace,
Session ID, invocation JWT, and token expiry. The target must be inside current account standing
and admission; a cross-Tenant or invisible target is `NOT_FOUND`. Session credentials and returned
invocation JWTs are sensitive and use the redaction rules in [Access](../access/).

`GetInvocationVerificationKeys` has an empty request and returns one to eight active or retiring
RS256 public keys plus an absolute cache expiry. Each key contains a unique key ID of one to 128
ASCII characters and base64url modulus and exponent values. The expiry is after the response time
and no more than five minutes later. Receivers refresh on expiry or an unknown key ID. An empty,
duplicate, malformed, expired, or oversized response is unavailable rather than an empty authority.
The operation never returns private or symmetric key material.

### Principal and execution results

Principal resolution returns only the requested principal's kind, canonical ID, enabled or retired
state, immutable owner and attached account where applicable, exact Tenant/Workspace standing,
revision, and finite expiry. Group membership is a separate paginated operation in either indexed
principal-to-Group or Group-to-direct-member direction; nested expansion does not exist.

Virtual-principal creation receives one immutable App-component or Job owner, exact Placement, and
attached User. `identityd` validates the owner through `pkgd` or `execd`, validates the Placement
through `execd`, and accepts only the caller that owns that kind. The generated principal ID does
not contain Package, component, trigger, schedule, event, display name, or attached-account text.

Runtime-principal minting derives App component or Run, virtual principal, attached account,
Placement, workload generation, and Kubernetes workload from the authenticated runtime proxy and
current owner facts. A request cannot supply substitute identity. A proxy credential additionally
names one existing dependency binding and audience; it expires no later than the workload token or
the configured 60-second maximum.

## Administrative resources

- A User has immutable kind (`human` or `service`) and immutable global or Tenant owner. Mutable
  fields are bounded display metadata and enabled state. Global admits only non-login service Users.
- A Membership has immutable User and Tenant or Workspace scope. Its mutable management standing is
  exactly `admin` or `member`.
- A Group has immutable Tenant or Workspace scope. Group-member records bind one direct User or
  valid virtual principal; duplicate and nested membership are rejected.
- An identity link permanently binds one provider subject to one human User in one Tenant. Provider
  subject and User are immutable and cannot be reassigned.
- An SSO provider has immutable Tenant and protocol class, bounded non-secret protocol
  configuration, `configd` Secret references, one `egressd` destination, and enabled state.
- The Tenant admission policy always exists. A Workspace policy is optional and stores only a
  subset of enabled Tenant provider IDs; explicit empty denies login and deletion restores
  inheritance.
- Sessions expose metadata, origin provider, bounded times, and revocation state but never the
  opaque credential. Virtual and runtime principals are read-only administrative projections.

All collections use exact owner selectors, bounded pagination, and the caller's visibility fence.
User disable, Session revoke, provider disable, and principal lifecycle changes are explicit
subresources with idempotency and revision preconditions.

## Callers and dependencies

| Callee | Purpose |
| --- | --- |
| `tenantd` | Validate exact parent Tenant or Workspace and current state |
| `pkgd` | Validate App, component, Package, and virtual-principal owner references |
| `execd` | Validate Placement, Job, Run, dependency, workload generation, and runtime references |
| `egressd` | Perform only the provider discovery, authorization, token, and user-info HTTP admitted by the SSO binding |
| `auditd` | Deliver identity mutation and authentication evidence directly |

`policyd`, `configd`, `pkgd`, `execd`, `egressd`, `auditd`, runtime proxies, `authd`, and `edged`
call only the exact operations admitted to them above. No caller receives a generic identity query,
token-minting, provider, or secret interface.

## Verification

Canonical evidence covers every resource and direct operation, all User kinds and Placement
attachment combinations, paginated Group membership, provider and Workspace narrowing, login
transaction replay and callback failure, Session exchange and revocation, key rotation and cache
expiry, invocation claim shapes, virtual/runtime identity lifecycle, process-bound credential
replay from another runtime, cross-Tenant invisibility, disabled-account propagation, downstream
outage, cancellation, concurrency, telemetry redaction, and direct audit delivery.

## User scopes, groups, and management roles

Human Users and ordinary service Users belong to exactly one Tenant. A global service User belongs
to the installation, has no Membership, identity link, or browser session, and may attach only to a
global App component or Job.

Membership role is only `admin` or `member` for CtlFlow management standing. Product labels such as
partner, client, deal team, committee, or distribution list are Groups. A Group may be Tenant- or
Workspace-scoped and may contain accounts or valid virtual principals in that scope.

Nested Groups are rejected. Group expansion is bounded and paginated. Group membership grants no
authority unless `policyd` has a matching grant.

## Boundaries and invariants

- One external provider subject maps to at most one human User in one Tenant.
- A User has at most one Membership for the same Tenant or Workspace.
- Service Users have no SSO links or browser sessions.
- A virtual principal has exactly one immutable attached account and owner App component or Job.
- The attached User must match the target Placement: global service User for global; current
  Tenant or Workspace standing for shared work; exact owning User for private work.
- A runtime principal belongs to exactly one admitted execution generation.
- User deletion is rejected while an App component or Job virtual principal remains attached.
- Disabling an account revokes Sessions, blocks new invocation and proxy credentials, and causes
  `execd` to suspend attached execution.
- Removing required Tenant or Workspace standing blocks new invocation and proxy credentials for
  that boundary and causes `execd` to suspend affected private or attached execution.
- Workspace admission can narrow and cannot widen Tenant admission.
- Every Tenant has one admission policy; a Workspace policy is optional and deletion restores
  inheritance.
- Disabling an SSO provider blocks new login and revokes sessions established through it.
- Caller-supplied subject, Actor, attached account, Tenant, Workspace, Placement, Session, Run, and
  token lifetime fields are ignored.
- Invocation JWT signing uses asymmetric keys. Callers receive only tokens and verification keys,
  never signing material.
- The installation projects the active invocation-signing key set from kernel bootstrap custody
  into `identityd` alone through private files, never environment values or `configd`.
- `identityd` signs only with the active key and publishes the active and retiring public keys.
- Verification keys overlap rotation by more than the maximum invocation lifetime. Receivers cache
  them for a finite owner-supplied lifetime and refresh on expiry or an unknown key ID.
- A cached known key may validate an otherwise current token while `identityd` is unavailable. An
  unknown key, expired token, or expired key cache fails closed.
- An invocation JWT is accepted only beside an authenticated Kubernetes workload identity.
- `identityd` does not resolve a downstream endpoint or participate in every internal hop.
- Only `authd` handles public authentication HTTP; `identityd` is reachable only through its private
  Kubernetes Service.
- `identityd` owns no application profile, presence, Package, Placement, grant, or Kubernetes record.

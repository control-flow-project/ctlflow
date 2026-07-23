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

| Operation family | Purpose |
| --- | --- |
| Authentication | Resolve options and begin or complete one login transaction for `authd` |
| Session | Create, validate, revoke, and inspect a browser Session |
| Invocation | Issue one short-lived internal invocation JWT |
| Verification keys | Return the current bounded internal verification-key set |
| Principal | Resolve account, Group, Membership, virtual, and runtime facts |
| Virtual principal | Create, disable, and retire exact App-component or Job identity |
| Runtime principal | Mint and retire one process execution identity |
| Proxy credential | Issue one process-bound credential for an exact trusted proxy dependency |

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

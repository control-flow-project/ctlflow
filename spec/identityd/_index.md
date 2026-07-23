---
title: identityd
weight: 45
---

`identityd` establishes who a caller or workload is, where an account has standing, and how
delegated identity is bounded.

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
- Start and complete OIDC or other admitted login flows.
- Mint, validate, list, and revoke opaque browser sessions.
- Create a virtual principal attached to one existing enabled User admitted for the target
  Placement.
- Mint and retire a process-specific runtime principal for an admitted execution.
- Exchange one validated invocation for a short-lived exact-audience call credential.
- Mint process-bound proxy credentials for an exact dependency.
- Resolve canonical account, Group, Membership, and principal facts for authorized callers.

## Authentication flow

```text
 browser -> edged -> identityd
                    +-- resolve Tenant login options
                    +-- call admitted provider through egressd
                    +-- validate provider response
                    +-- resolve User and Membership
                    +-- mint opaque Tenant session
```

Provider public configuration belongs to `identityd`. Provider secret material belongs to
`configd`. Discovery and token exchange use an explicitly bound `egressd` destination.

Login is Tenant-scoped. A Workspace may only narrow the Tenant provider set. Returning to a
Workspace never creates Membership.

Login state is short-lived, one-use, bound to the exact Tenant, provider, origin, and validated
return target. Browser endpoints enforce secure-cookie, origin, CSRF, replay, and bounded
rate-limit rules without revealing whether a User exists.

## Delegation flow

```text
 runtime proxy
   -> authenticate concrete runtime principal
   -> present declared dependency and optional invocation handle
   -> identityd resolves App or Job, attached account, Placements, and exact endpoint
   -> mint short-lived credential for that endpoint only
   -> emit parent-to-child delegation evidence to auditd
```

The original Actor remains unchanged only when the current valid invocation handle is supplied.
Otherwise the calling virtual principal becomes the Actor. A credential never names more than one
audience and is never forwarded to another target.

## Direct operations

| Operation family | Purpose |
| --- | --- |
| Login | Resolve options, start flow, complete flow, logout |
| Session | Mint, validate, revoke, and inspect current session |
| Principal | Resolve account, Group, Membership, virtual, and runtime facts |
| Virtual principal | Create, disable, and retire exact App-component or Job identity |
| Runtime principal | Mint and retire one process execution identity |
| Exchange | Issue exact-audience call or proxy credential |

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
- Disabling an account revokes sessions and new delegated credentials and causes `execd` to suspend
  attached execution.
- Removing required Tenant or Workspace standing revokes new delegated credentials for that
  boundary and causes `execd` to suspend affected private or attached execution.
- Workspace admission can narrow and cannot widen Tenant admission.
- Every Tenant has one admission policy; a Workspace policy is optional and deletion restores
  inheritance.
- Disabling an SSO provider blocks new login and revokes sessions established through it.
- Caller-supplied principal, attached-account, Tenant, Placement, audience, and call-chain fields are
  ignored.
- `identityd` owns no application profile, presence, Package, Placement, grant, or Kubernetes record.

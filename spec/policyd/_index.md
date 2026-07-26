---
title: policyd
weight: 50
---

`policyd` decides whether an established principal may perform one declared operation on one
canonical resource path.

## Owns

| Record | Meaning |
| --- | --- |
| Role | Named set of operation and path rules |
| Role binding | Role assigned to an exact principal or Group in one scope |
| Access grant | Direct allow-only operation and path rule |
| Access review | Side-effect-free effective decision |

It serves `roles`, `rolebindings`, `accessgrants`, and create-only `accessreviews` in
`policy.ctlflow.com/v1alpha1`.

## Path model

Paths are Unix-like absolute paths made from canonical, delimiter-safe segments. Empty, traversal,
NUL, ambiguous escaping, and character-prefix matching are rejected.

```text
 grant
   principal  grp-partners
   operation  agreements.approve
   path       /tenants/ten-1/workspaces/wsp-2/agreements
   match      subtree

 allow  agreements.approve on .../agreements/agr-7
 deny   agreements.write   on .../agreements/agr-7
 deny   agreements.approve in another Workspace
```

Application operation tokens are immutable Package declarations owned by `pkgd`. Kernel management
operation tokens are immutable declarations owned by the kernel service that implements them.
`policyd` treats both as typed identities and never interprets their domain meaning.

## Decision

The Actor decision intersects:

```text
current Tenant and Workspace state
AND Actor account, Membership, and Group facts
AND matching Actor grants and Role bindings
AND exact operation and canonical path
```

If the Actor is virtual, that decision also intersects its attached-account authority and
virtual-principal grants. A request made through an App component or Run additionally intersects:

```text
immediate caller's attached-account authority
AND immediate caller's virtual-principal grants
AND Package capability ceiling
AND source and target Placement fence
AND current App, Job, Run, and runtime state
```

No matching grant means denial. Placement limits where a decision applies but creates no grant.
Placement execution constraints remain `execd` state and are not represented as policy grants.

An external exposure explicitly declared `anonymous` or `application-authenticated` has no Actor
grant to evaluate. For its coarse exposure operation, `policyd` instead requires the authenticated
immediate caller to be `edged`, the exact current `pkgd` exposure to declare that class and
operation, and every owner/Placement state layer to admit it. This narrow reachability decision
does not authenticate the external caller or authorize an application object.

`check` returns one allow or deny decision. `explain` returns the same decision plus the first
authoritative denying layer. Both use the same evaluator.

## Enforcement

The service or application component owning a protected resource is the enforcement point. An
application's runtime proxy supplies the original Actor and immediate caller as verified
identities. The owner calls `policyd` under its own identity and names one operation it declares.

`policyd` verifies:

1. the enforcing kernel service or Package component owns the operation declaration;
2. the invocation JWT, when present, names the current installation, subject account, and Actor;
3. the immediate Kubernetes workload and runtime are current and admitted to enforce that
   operation;
4. Tenant, Workspace, Placement, Package, account, and principal facts are current; and
5. the canonical path is inside the admitted fence.

The resource-owning application applies the decision and then enforces its own domain invariants.
A positive review is not a data capability and cannot be replayed as a credential.

Authority projections called by `policyd`, such as principal, resource state, Package ceiling, and
runtime-context resolution, authenticate `policyd` and enforce their exact visibility fence but do
not recursively request another policy decision. They expose only the narrow facts listed in their
owner contracts and are not general product reads.

## Direct operations

| Operation | Admitted caller | Purpose |
| --- | --- | --- |
| CheckAccess | Kernel or Package component owning the protected operation | Return one effective allow or deny |
| ExplainAccess | The same owner with explicit explain authority | Return the same decision with bounded denying-layer detail |
| BuildResourcePath | Kernel or Package component owning the path grammar | Build one canonical owner-qualified path from validated segments |

Administrative Role, binding, grant, and review operations use the private `policyd` contract.

### Decision contract

`CheckAccess` and `ExplainAccess` receive:

```text
declared operation token
canonical resource path
exact target Tenant and optional Workspace
exact target Placement when the operation has one
owner resource revision when required
```

Actor, subject account, immediate caller, caller account, source Placement, runtime principal, and
invocation origin come only from authenticated transport context. An autonomous workload call uses
its virtual principal as Actor. An AccessReview may name a hypothetical principal only when the
authenticated infrastructure operator has review authority; it enters the same evaluator and never
becomes invocation identity.

The result contains:

```text
decision: allow or deny
stable decision reason
evaluated operation and canonical path
bounded revisions of consulted owner facts
evaluation time
```

`ExplainAccess` additionally returns the first denying layer from this closed set:

```text
lifecycle
account-standing
actor-grant
attached-account
caller-principal
package-ceiling
placement-fence
operation-owner
```

It never returns Group expansion, hidden grants, another principal's policy, raw downstream errors,
or a replayable capability. No decision is an authorization token or reusable cached allow.

`BuildResourcePath` receives an operation owner plus a finite ordered list of already typed
resource-kind and canonical-ID segments. It returns the absolute canonical path or
`INVALID_ARGUMENT`. It does not look up a record, infer a parent, authorize an operation, or accept
an arbitrary path string to normalize.

## Administrative resources

A Role has immutable global, Tenant, or Workspace scope and a finite set of allow-only rules. Each
rule contains declared operation tokens, one canonical exact or subtree path, and no deny rule. A
Role binding has immutable scope, Role, and exact User, Group, or virtual-principal subject. An
Access grant has immutable scope and subject plus one finite direct rule set. Mutations require
the current revision and cannot move a record, subject, or path to another scope.

A create-only AccessReview contains operation, path, target fence, optional infrastructure-authorized
hypothetical principal, and the resulting decision. It is evaluated synchronously, is not retained
as a grant, and cannot be updated. Lists and watches of policy records use exact scope selectors and
the common bounded collection contract.

## Callers and dependencies

| Callee | Purpose |
| --- | --- |
| `tenantd` | Resolve current Tenant and Workspace state |
| `identityd` | Resolve Actor, attached account, Membership, and direct Group facts |
| `pkgd` | Validate Package operation ownership and capability ceiling |
| `execd` | Validate source/target Placement, runtime, App, Job, and Run lifecycle |
| `auditd` | Deliver policy mutation and decision evidence directly |

Resource-owning applications and kernel services call `CheckAccess`; `edged` calls it only for the
coarse external exposure operation. Callers cannot ask `policyd` to read or mutate the protected
application object.

## Failure and verification

Malformed operation or path is `INVALID_ARGUMENT`. An operation not declared by the authenticated
owner, an unavailable required owner fact, or any missing grant produces deny; dependency
unavailability uses stable reason `authority-unavailable` and never falls back to stale allow.
Targets outside the caller's visibility remain `NOT_FOUND`.

Canonical evidence covers exact and subtree matching at delimiter boundaries, every denying layer,
all Actor and attached-account combinations, direct Group membership and pagination, Package and
Placement ceilings, lifecycle changes during review, operation-owner spoofing, hypothetical
administrative review isolation, no-match denial, dependency outage, cancellation, concurrent
policy revision, telemetry redaction, and decision audit evidence.

## Invariants

- Every Role, binding, and grant belongs to one exact global, Tenant, or Workspace fence.
- A Group contributes only current direct members from `identityd`.
- A workload can never exceed its attached account, Package ceiling, or Placement fence.
- Only the kernel service or Package component owning an operation may enforce it.
- Kubernetes RBAC governs Kubernetes resources and never substitutes for application policy.
- `policyd` validates required transport identities but issues no identity and stores no application
  object.
- Decisions fail closed when any required authority cannot be established.

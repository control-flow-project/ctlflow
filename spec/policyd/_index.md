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
current Tenant and Workspace lifecycle
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
AND current App, Job, Run, and runtime lifecycle
```

No matching grant means denial. Placement limits where a decision applies but creates no grant.
Placement execution constraints remain `execd` state and are not represented as policy grants.

`check` returns one allow or deny decision. `explain` returns the same decision plus the first
authoritative denying layer. Both use the same evaluator.

## Enforcement

The service or application component owning a protected resource is the enforcement point. An
application's runtime proxy supplies the original Actor and immediate caller as verified
identities. The owner calls `policyd` under its own identity and names one operation it declares.

`policyd` verifies:

1. the enforcing kernel service or Package component owns the operation declaration;
2. the Actor credential audience identifies that endpoint;
3. the immediate caller and runtime are current;
4. Tenant, Workspace, Placement, Package, account, and principal facts are current; and
5. the canonical path is inside the admitted fence.

The resource-owning application applies the decision and then enforces its own domain invariants.
A positive review is not a data capability and cannot be replayed as a credential.

## Direct operations

| Operation | Purpose |
| --- | --- |
| Check | Return one effective allow or deny |
| Explain | Return the same decision with bounded reasoning |
| ValidatePath | Canonicalize and validate an owner-qualified path |

Administrative Role, binding, and grant mutations use aggregated resources.

## Invariants

- Every Role, binding, and grant belongs to one exact global, Tenant, or Workspace fence.
- A Group contributes only current direct members from `identityd`.
- A workload can never exceed its attached account, Package ceiling, or Placement fence.
- Only the kernel service or Package component owning an operation may enforce it.
- Kubernetes RBAC governs Kubernetes resources and never substitutes for application policy.
- `policyd` authenticates no caller and stores no application object.
- Decisions fail closed when any required authority cannot be established.

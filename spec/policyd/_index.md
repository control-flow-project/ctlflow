---
title: policyd
weight: 60
---

`policyd` owns application-data authorization: whether a principal may perform a declared
operation on an application resource path.

## Owns

An Access grant is an allow-only statement containing a principal, operation token, absolute path,
and either exact or subtree matching. `policyd` serves `accessgrants` and create-only
`accessreviews` in `policy.ctlflow.com/v1alpha1`.

Paths are Unix-like absolute paths composed of canonical segments. Empty segments, traversal
segments, NUL, and ambiguous escaping are rejected. Prefix matching operates on parsed segments,
not character prefixes.

```text
 grant:  files.read on /workspaces/wsp-123/files, subtree

 allow:  files.read on /workspaces/wsp-123/files/report.pdf
 deny:   files.write on /workspaces/wsp-123/files/report.pdf
 deny:   files.read on /workspaces/wsp-456/files/report.pdf
```

## Decision

For a human or service account, the decision intersects matching grants with Tenant, Membership,
Context, and lifecycle state. For an App component or Job, it additionally intersects the attached
account's authority and the Package capability ceiling.

No matching grant means denial. A Context limits where a decision can apply but never creates a
grant.

The request is already fenced to one Tenant. Tenant and tenant-user Contexts may address paths in
that Tenant; workspace and workspace-user Contexts are additionally confined to
`/workspaces/<workspace-id>`. User-specific Contexts isolate placement and state but add no
permission beyond the attached account's grants.

`check` returns one decision. `explain` returns the same decision plus the layer that denied it.
Both use the same evaluator. Administrative access reviews are side-effect-free; workloads use the
direct runtime endpoint.

The App component that owns the protected resource is the policy enforcement point. It calls the
runtime endpoint under its own workload identity and presents the original caller's verifiable
tenant or workload credential, never a caller-supplied principal string. `policyd` verifies both,
requires the caller credential's audience to identify that enforcement point, requires the
enforcement point's Package to own the operation token, and evaluates the original caller. The
resource service enforces the result. A policy decision is not itself access to data.

## Boundaries and invariants

- Operation tokens are declared by Packages in `catalogd`; `policyd` never interprets their
  application meaning.
- Only a component of the Package that declares an operation may enforce that operation.
- Kubernetes RBAC governs Kubernetes APIs, not application resource paths.
- `policyd` authenticates no caller; it consumes established identity.
- Grants may target accounts, Jobs, or App components. A grant is removed when its referenced
  principal is removed.
- No workload grant can exceed its attached account, Package capability ceiling, or concrete
  Context.
- Decisions fail closed when required current authority cannot be established.

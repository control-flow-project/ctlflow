---
title: Policy
weight: 90
---

Policy governs declared application operations on Unix-like resource paths. It is independent of
Kubernetes RBAC and external network access.

```text
ctlflow policy grant list --tenant TENANT [--scope CONTEXT]
ctlflow policy grant get GRANT --tenant TENANT
ctlflow policy grant create --tenant TENANT -f FILE
ctlflow policy grant delete GRANT --tenant TENANT [--force]

ctlflow policy check --tenant TENANT --principal PRINCIPAL --scope CONTEXT \
  --operation OPERATION --path PATH
ctlflow policy explain --tenant TENANT --principal PRINCIPAL --scope CONTEXT \
  --operation OPERATION --path PATH
```

```yaml
principal: usr-123
operation: files.read
path: /workspaces/wsp-456/files
match: subtree
```

Grants are allow-only and target an account, Job, or App-component principal. Operation tokens are
defined by Packages. Paths use exact or subtree matching on canonical segments. No matching grant
means denial.

`check` returns one effective decision. `explain` returns the same result and identifies the layer
that denied it. For workload principals, the evaluator intersects the grant with attached-account
authority, Package capability ceiling, Context, and lifecycle state.

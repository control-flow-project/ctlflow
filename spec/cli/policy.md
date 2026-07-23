---
title: Policy
weight: 75
---

Policy grants declared operations on canonical Unix-like resource paths.

```text
ctlflow get roles (--global | --tenant TENANT | --all-tenants) [--workspace WORKSPACE]
ctlflow get role ROLE (--global | --tenant TENANT)
ctlflow apply role (--global | --tenant TENANT) -f FILE
ctlflow delete role ROLE (--global | --tenant TENANT) [--force]

ctlflow get role-bindings (--global | --tenant TENANT | --all-tenants) [--workspace WORKSPACE]
ctlflow get role-binding BINDING (--global | --tenant TENANT)
ctlflow apply role-binding (--global | --tenant TENANT) -f FILE
ctlflow delete role-binding BINDING (--global | --tenant TENANT) [--force]

ctlflow get access-grants (--global | --tenant TENANT | --all-tenants) [--workspace WORKSPACE]
ctlflow get access-grant GRANT (--global | --tenant TENANT)
ctlflow apply access-grant (--global | --tenant TENANT) -f FILE
ctlflow delete access-grant GRANT (--global | --tenant TENANT) [--force]

ctlflow check access (--global | --tenant TENANT) \
  --principal PRINCIPAL --operation OPERATION --path PATH
ctlflow explain access (--global | --tenant TENANT) \
  --principal PRINCIPAL --operation OPERATION --path PATH
```

Rules are allow-only and use exact or subtree path matching. No matching rule means denial.
Workload authority is additionally bounded by its attached account, Package capability ceiling,
Placement, and lifecycle. Kubernetes RBAC and egress admission are separate controls.

`check` and `explain` use the same evaluator; `explain` adds bounded reasoning and never grants a
replayable capability.

---
title: SSO
weight: 35
---

An SSO provider belongs to one Tenant. A Workspace admission policy may narrow the enabled Tenant
provider set but cannot add another provider.

```text
ctlflow get sso-providers --tenant TENANT
ctlflow get sso-provider PROVIDER --tenant TENANT
ctlflow create sso-provider --tenant TENANT -f FILE
ctlflow apply sso-provider PROVIDER --tenant TENANT -f FILE
ctlflow enable sso-provider PROVIDER --tenant TENANT
ctlflow disable sso-provider PROVIDER --tenant TENANT [--force]
ctlflow delete sso-provider PROVIDER --tenant TENANT [--force]

ctlflow get admission-policies --tenant TENANT [--workspace WORKSPACE]
ctlflow get admission-policy --tenant TENANT [--workspace WORKSPACE]
ctlflow apply admission-policy --tenant TENANT [--workspace WORKSPACE] -f FILE
ctlflow delete admission-policy --tenant TENANT --workspace WORKSPACE [--force]
```

Provider secret fields reference write-only [Secrets](../config/). Provider discovery and exchange
use an admitted `egressd` destination; `identityd` has no independent external network path.

The Tenant policy always exists and may be empty. No Workspace policy means Tenant inheritance. An
explicit empty Workspace policy denies SSO entry; deleting it restores inheritance. Login never
creates a User or Membership implicitly.

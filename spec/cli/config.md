---
title: Configuration And Secrets
weight: 45
---

Configuration, secret custody, and dependency-provider selection are separate records owned by
`configd`.

```text
ctlflow get configurations (--global | --tenant TENANT | --all-tenants)
ctlflow get configuration CONFIGURATION (--global | --tenant TENANT)
ctlflow apply configuration (--global | --tenant TENANT) -f FILE
ctlflow delete configuration CONFIGURATION (--global | --tenant TENANT) [--force]
ctlflow resolve configuration --consumer CONSUMER (--global | --tenant TENANT)

ctlflow get secrets (--global | --tenant TENANT | --all-tenants)
ctlflow get secret SECRET (--global | --tenant TENANT)
ctlflow create secret (--global | --tenant TENANT) -f FILE
ctlflow set secret-material SECRET (--global | --tenant TENANT) --from-file FILE
ctlflow rotate secret-material SECRET (--global | --tenant TENANT) --from-file FILE
ctlflow revoke secret-version SECRET VERSION (--global | --tenant TENANT) [--force]
ctlflow delete secret SECRET (--global | --tenant TENANT) [--force]

ctlflow get provider-configurations (--global | --tenant TENANT | --all-tenants)
ctlflow get provider-configuration CONFIGURATION (--global | --tenant TENANT)
ctlflow apply provider-configuration (--global | --tenant TENANT) -f FILE
ctlflow delete provider-configuration CONFIGURATION (--global | --tenant TENANT) [--force]
```

Documents carry their exact global, Tenant, Workspace, user, App, or Job scope. `resolve` reports
the effective values, ordered sources, and immutable generation for one consumer. Reads of a Secret
return only metadata, policy, version, commitment, and readiness. Secret material is write-only and
is never printed or returned.

Provider configuration selects one exact installed provider for one declared dependency and
supplies only options admitted by its immutable schema. It never embeds a resolved endpoint or
credential.

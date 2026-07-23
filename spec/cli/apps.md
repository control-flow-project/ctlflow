---
title: Apps
weight: 55
---

An App is one App Package installed at one Placement and attached to one existing User account.

```text
ctlflow get apps (--global | --tenant TENANT | --all-tenants) [--placement PLACEMENT]
ctlflow get app APP (--global | --tenant TENANT)
ctlflow install app PACKAGE (--global | --tenant TENANT) \
  --placement PLACEMENT --account USER [-f FILE] [--wait]
ctlflow upgrade app APP (--global | --tenant TENANT) --package PACKAGE [-f FILE] [--wait]
ctlflow scale app APP (--global | --tenant TENANT) --component COMPONENT --replicas COUNT [--wait]
ctlflow suspend app APP (--global | --tenant TENANT) [--wait]
ctlflow resume app APP (--global | --tenant TENANT) [--wait]
ctlflow remove app APP (--global | --tenant TENANT) [--force] [--wait]
ctlflow logs app APP (--global | --tenant TENANT) [--component COMPONENT] [--follow]
```

Installation supplies Package-declared configuration and exact provider selections. Secret values
are managed through [Configuration And Secrets](../config/). Required dependencies must be ready
before the App becomes active.

Placement and attached account are immutable for one App. Each explicit compatible upgrade creates
a generation pinned to one immutable Package version. Installing the same Package in another
Placement creates a separate App with separate principals, bindings, state, and realization.
Global Apps require a global service User; every other account must have standing in the target
Placement. Removal follows each persistent slot's explicit retain-or-delete policy.

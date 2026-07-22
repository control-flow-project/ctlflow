---
title: Apps
weight: 50
---

An App is one App Package installed in one Context and attached to one existing User account.

```text
ctlflow app list --tenant TENANT [--scope CONTEXT]
ctlflow app get APP --tenant TENANT
ctlflow app install PACKAGE --tenant TENANT --scope CONTEXT --account USER [-f FILE] [--wait]
ctlflow app update APP --tenant TENANT -f FILE [--wait]
ctlflow app secret set APP SLOT --tenant TENANT --from-file FILE [--wait]
ctlflow app secret delete APP SLOT --tenant TENANT [--force] [--wait]
ctlflow app suspend APP --tenant TENANT [--wait]
ctlflow app resume APP --tenant TENANT [--wait]
ctlflow app logs APP --tenant TENANT [--component COMPONENT] [--follow]
ctlflow app remove APP --tenant TENANT [--force] [--wait]
```

The App document supplies Package-defined configuration and bindings for persistent data and
required service endpoints. Secret values use the separate write-only operation. Required bindings
must be ready before execution is admitted.

The Context and attached account are immutable. Running the same Package in several Contexts means
creating one App in each; CtlFlow performs no implicit fanout. Updating an App may select a newer
version of the same Package and change mutable Package-defined configuration.

Each App component receives a distinct virtual principal bounded by the attached account, Package
capability ceiling, Access grants, and App Context. A private user installation is forced to the
creator's account; an administrator installing shared software selects the account explicitly.

`remove` uninstalls the App and retires its realization. Retention or destruction of bound
persistent data follows the explicit App document and is never inferred from a Kubernetes object.

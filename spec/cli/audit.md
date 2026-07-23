---
title: Audit
weight: 85
---

Audit Events are authoritative kernel security and activity evidence.

```text
ctlflow get audit-events (--global | --tenant TENANT | --all-tenants) \
  --since TIME --until TIME
ctlflow get audit-event EVENT (--global | --tenant TENANT)
ctlflow create audit-export (--global | --tenant TENANT) --from TIME --to TIME [--wait]
ctlflow get audit-exports (--global | --tenant TENANT | --all-tenants)
ctlflow get audit-export EXPORT (--global | --tenant TENANT)
ctlflow download audit-export EXPORT (--global | --tenant TENANT) --output FILE
ctlflow redact audit-payload EVENT (--global | --tenant TENANT) --reason REASON [--force]
ctlflow delete audit-payload EVENT (--global | --tenant TENANT) --reason REASON [--force]
```

Queries are partitioned, time-bounded, and paginated. Large extraction creates an asynchronous
Export; bytes use purpose-bound transfer access and never an administrative resource body.

Events are immutable. An authorized legal deletion removes prohibited retained detail, preserves
its digest commitment and envelope, and appends a new deletion event. Program logs are not Audit
Events.

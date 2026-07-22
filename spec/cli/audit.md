---
title: Audit
weight: 110
---

Audit Events are immutable security and activity evidence.

```text
ctlflow audit list --tenant TENANT [--since TIME] [--until TIME] [--watch]
ctlflow audit list --all-tenants [--since TIME] [--until TIME] [--watch]
ctlflow audit list --infrastructure [--since TIME] [--until TIME] [--watch]
ctlflow audit get EVENT (--tenant TENANT | --infrastructure)

ctlflow audit export create (--tenant TENANT | --infrastructure) \
  --from TIME --to TIME [--wait]
ctlflow audit export list (--tenant TENANT | --infrastructure)
ctlflow audit export get EXPORT (--tenant TENANT | --infrastructure)
ctlflow audit export download EXPORT (--tenant TENANT | --infrastructure) --output FILE
```

Workload activity records both virtual principal and attached account. Infrastructure activity is
kept separate from Tenant partitions; `--all-tenants` does not silently include it.

Lists are time-bounded and paginated. Large historical extraction creates an asynchronous Export.
Export metadata is returned by the API; bytes move through short-lived object-storage transfer
access mediated by `egressd`. Audit is not the App or Run log stream.

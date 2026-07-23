---
title: Egress
weight: 80
---

Egress records admit exact workload principals and declared dependencies to approved external HTTP
destinations.

```text
ctlflow get egress-destinations (--global | --tenant TENANT | --all-tenants)
ctlflow get egress-destination DESTINATION (--global | --tenant TENANT)
ctlflow apply egress-destination (--global | --tenant TENANT) -f FILE
ctlflow enable egress-destination DESTINATION (--global | --tenant TENANT)
ctlflow disable egress-destination DESTINATION (--global | --tenant TENANT)
ctlflow delete egress-destination DESTINATION (--global | --tenant TENANT) [--force]

ctlflow get egress-policies (--global | --tenant TENANT | --all-tenants)
ctlflow get egress-policy POLICY (--global | --tenant TENANT)
ctlflow apply egress-policy (--global | --tenant TENANT) -f FILE
ctlflow delete egress-policy POLICY (--global | --tenant TENANT) [--force]

ctlflow check egress (--global | --tenant TENANT) \
  --principal PRINCIPAL --dependency DEPENDENCY \
  --destination DESTINATION --method METHOD --path PATH
ctlflow explain egress (--global | --tenant TENANT) \
  --principal PRINCIPAL --dependency DEPENDENCY \
  --destination DESTINATION --method METHOD --path PATH
```

A Destination declares one approved HTTP origin and deterministic generic rewrites. A policy names
the admitted callers, dependency, Placement fence, methods, and paths. Upstream credentials are
write-only [Secrets](../config/) referenced by the Destination.

`check` and `explain` perform the same decision without forwarding or revealing secret material.
Non-HTTP traffic and provider-specific protocol behavior are outside `egressd`.

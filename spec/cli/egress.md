---
title: Egress
weight: 100
---

Egress configuration admits selected workload principals to approved external HTTP destinations.

```text
ctlflow egress destination list (--infrastructure | --tenant TENANT)
ctlflow egress destination get DESTINATION (--infrastructure | --tenant TENANT)
ctlflow egress destination create (--infrastructure | --tenant TENANT) -f FILE
ctlflow egress destination update DESTINATION (--infrastructure | --tenant TENANT) -f FILE
ctlflow egress destination credential set DESTINATION \
  (--infrastructure | --tenant TENANT) --from-file FILE
ctlflow egress destination credential delete DESTINATION \
  (--infrastructure | --tenant TENANT) [--force]
ctlflow egress destination enable DESTINATION (--infrastructure | --tenant TENANT)
ctlflow egress destination disable DESTINATION (--infrastructure | --tenant TENANT)
ctlflow egress destination delete DESTINATION \
  (--infrastructure | --tenant TENANT) [--force]

ctlflow egress policy list --tenant TENANT
ctlflow egress policy get POLICY --tenant TENANT
ctlflow egress policy create --tenant TENANT -f FILE
ctlflow egress policy update POLICY --tenant TENANT -f FILE
ctlflow egress policy delete POLICY --tenant TENANT [--force]

ctlflow egress check DESTINATION --tenant TENANT --principal PRINCIPAL \
  --scope CONTEXT --method METHOD --path PATH
ctlflow egress explain DESTINATION --tenant TENANT --principal PRINCIPAL \
  --scope CONTEXT --method METHOD --path PATH
```

A Destination declares a logical key, approved HTTPS origin, typed credential strategy, and
ordered generic HTTP rewrites. Credential material is submitted separately and cannot be read
back. An Egress policy names admitted Job or App-component principals, optional Context, HTTP
methods, and paths.

Deleting a Destination is rejected while any policy or owning domain record references it.

`check` and `explain` are side-effect-free reviews. They show whether a request would be admitted
and which policy and rewrite would apply, without exposing secret material.

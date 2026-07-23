---
title: Packages
weight: 50
---

A Package is an immutable versioned App or Job contract with explicit ownership, provenance, and
trust.

```text
ctlflow get packages (--global | --tenant TENANT | --all-tenants) \
  [--workspace WORKSPACE] [--user USER]
ctlflow get package PACKAGE (--global | --tenant TENANT)
ctlflow publish package (--global | --tenant TENANT) -f FILE [--wait]
ctlflow revoke package PACKAGE (--global | --tenant TENANT) [--force] [--wait]
ctlflow get artifacts (--global | --tenant TENANT | --all-tenants) [--package PACKAGE]
ctlflow get artifact ARTIFACT (--global | --tenant TENANT)
ctlflow get service-contracts (--global | --tenant TENANT | --all-tenants)
ctlflow get service-contract CONTRACT (--global | --tenant TENANT)
ctlflow get exposures (--global | --tenant TENANT | --all-tenants)
ctlflow get exposure EXPOSURE (--global | --tenant TENANT)
```

The Package document declares digest-pinned artifacts, components, configuration and secret
schemas, persistent slots, dependencies, service contracts, exposures, operation tokens, and
resource requirements. It contains no credentials, resolved URLs, native Kubernetes names, or
provider-specific binding output.

Publication is idempotent for the same immutable key and canonical body. Revocation prevents new
installation and execution, stops active realization pinned to that version, and retains records
for evidence. No replacement version is selected automatically. OCI bytes move through registry
tooling; administrative resource bodies carry metadata only. Artifacts, service contracts, and
exposures are read-only projections of immutable Package declarations.

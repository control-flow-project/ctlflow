---
title: SSO
weight: 40
---

SSO providers and admission policy are Tenant records. Tenant administrators normally manage them
through the platform UI; these commands are the infrastructure-operator path over the same API.

```text
ctlflow sso provider list --tenant TENANT
ctlflow sso provider get PROVIDER --tenant TENANT
ctlflow sso provider create --tenant TENANT -f FILE
ctlflow sso provider update PROVIDER --tenant TENANT -f FILE
ctlflow sso provider credential set PROVIDER --tenant TENANT --from-file FILE
ctlflow sso provider credential delete PROVIDER --tenant TENANT [--force]
ctlflow sso provider enable PROVIDER --tenant TENANT
ctlflow sso provider disable PROVIDER --tenant TENANT [--force]
ctlflow sso provider delete PROVIDER --tenant TENANT [--force]

ctlflow sso admission get --tenant TENANT [--workspace WORKSPACE]
ctlflow sso admission allow PROVIDER --tenant TENANT [--workspace WORKSPACE]
ctlflow sso admission remove PROVIDER --tenant TENANT [--workspace WORKSPACE] [--force]
ctlflow sso admission delete --tenant TENANT --workspace WORKSPACE [--force]
```

The supported provider protocol is OIDC. A provider records issuer, client identity, claim mapping,
requested scopes, approved Egress Destinations, enabled state, and credential-binding readiness.
The issuer and every discovered external endpoint must match one of those Destinations. The client
secret is submitted only through the write-only credential command and cannot be read back.
Discovery and token exchange pass through `egressd`; `identityd` has no separate external path.

Disabling a provider blocks new login and invalidates sessions established through it.

Tenant admission selects enabled Tenant providers. A Workspace admission policy may narrow that
set but cannot introduce another provider. Admission never creates a User or Membership
implicitly. Deleting a provider is rejected while an admission policy or Identity link references
it.

No Workspace policy means inheritance from the Tenant. An explicit empty Workspace policy denies
SSO entry there. Deleting the Workspace policy restores inheritance; the Tenant policy itself
cannot be deleted.

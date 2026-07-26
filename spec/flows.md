---
title: Flows
weight: 24
---

These are the complete approved kernel flows. They name only operations present
in checked versioned contracts.

## Operator connection

```text
ctlflow
  -> load certificate-backed kubeconfig
  -> ask Kubernetes API for an authorized port-forward
  -> present the kubeconfig client certificate end to end
  -> call the owning private gRPC service
```

Kubernetes carries bytes after authorizing the tunnel. It does not translate
or persist the CtlFlow request.

## Tenant creation

```text
ctlflow create tenant -f tenant.yaml
  -> tenantd.CreateTenant
  -> tenantd validates immutable ID, address, and display name
  -> tenantd commits the active Tenant
  -> tenantd calls auditd.RecordAuditBatch
  -> tenantd returns the Tenant
```

The call creates no User, configuration, Placement, Package, App, Job, or
Workspace.

## Workspace creation

```text
ctlflow create workspace --tenant TENANT -f workspace.yaml
  -> tenantd.CreateWorkspace
  -> tenantd validates the active parent Tenant
  -> tenantd commits the active Workspace
  -> tenantd calls auditd.RecordAuditBatch
  -> tenantd returns the Workspace
```

Business records remain application data and are not Workspace fields.

## Operator reads and mutations

```text
ctlflow get tenants
  -> tenantd.ListTenants(page_size, after_tenant_id)

ctlflow update tenant TENANT --revision REVISION --display-name NAME
  -> tenantd.UpdateTenant

ctlflow suspend workspace WORKSPACE --revision REVISION
  -> tenantd.SetWorkspaceState(suspended)
```

Every list returns one bounded immutable-ID page. Every post-create mutation
uses the expected positive revision. A no-op returns current state without
another mutation or audit event.

## Address resolution

```text
admitted autonomous caller
  -> tenantd.ResolveTenant(tenant_address)
  -> tenantd.ResolveWorkspace(tenant_id, workspace_address)   optional
```

Resolution returns only active records and never creates route or cache state.

## Browser authentication and invocation

```text
POST /auth/v1/begin(tenant_id, provider_id, return_to)
  -> authd validates exact Origin, selection, and same-origin return target
  -> authd uses its startup-loaded Configd-owned provider projection
  -> authd stores one browser-bound, ten-minute in-flight attempt
  <- 303 to the exact configured provider

GET /auth/v1/callback(state, bounded provider fields)
  -> authd consumes the browser-bound attempt
  -> selected adapter validates the exact provider result
  -> identityd.CreateSession(tenant, provider, provider_subject)
       Authd workload mTLS; no account ID
       -> resolve current external identity link and Tenant standing
       -> commit Session
       -> auditd.RecordAuditBatch
  <- one-time opaque credential
  -> authd sets __Host-ctlflow-session
  <- 303 to the stored same-origin return target

authenticated application request
  -> edged
  -> identityd.ExchangeSession(cookie credential, exact target)
       -> validate Session, account, standing, and target
       -> sign short-lived Session-origin invocation JWT
  -> private product target with invocation JWT

POST /auth/v1/logout(return_to)
  -> authd validates exact Origin and opaque cookie
  -> identityd.RevokeSession(cookie credential)
       Authd workload mTLS
       -> commit actual revocation
       -> auditd.RecordAuditBatch
  -> authd clears its cookies
  <- 303 to the validated same-origin return target
```

Authd and Edged never receive invocation-signing material. Edged never
forwards the browser credential to a product target. Authd makes no Configd
call: the purpose-bound projection is mounted before startup. Unknown,
malformed, expired, mismatched, and replayed callback state fail without an
Identityd call. Provider or dependency failures never select another Tenant,
provider, return target, adapter, or identity.

## Run invocation

```text
admitted Execd Run
  -> identityd.IssueRunInvocation(actor, target, run_id)
       -> resolve current Actor, attached account, standing, and fence
       -> sign short-lived Run-origin invocation JWT
  -> product or kernel target with invocation JWT
```

Execd cannot name an attached account. Identityd derives it from a virtual
principal or uses the direct account Actor.

## Product management

```text
browser -> product backend
  -> backend calls capability-enabled tenantd operation
       workload token: backend identity
       invocation JWT: User or virtual Actor
  -> tenantd validates caller, invocation, and target fence
  -> tenantd calls policyd.CheckAccess
       -> identityd.GetInvocationVerificationKeys
       -> identityd.ResolvePrincipal
       -> identityd.ListPrincipalGroups
  -> tenantd applies allow, enforces Domain invariants, and commits
  -> tenantd calls auditd.RecordAuditBatch for an actual mutation
```

The approved capability operations and canonical paths are listed in
[tenantd](../tenantd/). The backend cannot supply its own Actor, operation
owner, capability token, or canonical resource path.

## Failure

```text
invalid identity or signature             -> UNAUTHENTICATED
authenticated but unadmitted caller       -> PERMISSION_DENIED
target outside invocation standing/fence  -> NOT_FOUND
no matching current allow                 -> PERMISSION_DENIED
identity/policy/audit/persistence outage  -> UNAVAILABLE
```

Dependency failure never falls back to earlier or broader authority.

## Telemetry

Every hop extracts and injects W3C trace context and exports bounded,
redacted OTLP telemetry. Collector failure remains bounded and cannot satisfy
or replace required audit evidence.

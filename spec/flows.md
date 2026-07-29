---
title: Flows
description: Approved end-to-end operator, browser, product, execution, and failure flows.
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

The call creates no User, configuration, Placement, Package, App, Run, or
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

## Package and App intent

```text
operator
  -> pkgd.DeclarePackage(complete immutable generation)
       -> commit generation
       -> auditd.RecordAuditBatch

operator or admitted scoped product backend
  -> pkgd.CreateApp(scope, Placement, Package generation)
       -> validate invocation and policyd.CheckAccess when capability-scoped
       -> commit App revision 1
       -> auditd.RecordAuditBatch

operator or admitted scoped product backend
  -> pkgd.SetAppPackageGeneration(App, expected revision, generation)
       -> validate invocation and policyd.CheckAccess when capability-scoped
       -> commit the sole App transition
       -> auditd.RecordAuditBatch

execd -> pkgd.GetApp -> pkgd.GetPackage
```

Pkgd has no list, build, artifact-transfer, lifecycle, dependency-provisioning,
or Kubernetes operation. Reads and no-op App updates emit no audit event.

## Placement and execution

```text
operator or admitted scoped product backend
  -> execd.DeclarePlacement
       -> validate parent and inherited constraints
       -> commit Placement intent
       -> auditd.RecordAuditBatch
       -> reconciler applies the owned Namespace

operator or admitted scoped product backend
  -> execd.DeclareWorkload
       -> pkgd.GetApp
       -> verify exact App Placement and scope
       -> pkgd.GetPackage
       -> validate and snapshot component, artifact, interfaces, dependencies
       -> commit Workload intent
       -> auditd.RecordAuditBatch
       -> reconciler applies projections, claims, storage, and workload objects

operator or admitted scoped product backend
  -> execd.CreateRun(finite Workload)
       -> commit immutable Run snapshot
       -> auditd.RecordAuditBatch
       -> reconciler calls identityd.IssueRunInvocation for a non-Global Run
       -> reconciler maintains the process-private invocation projection
       -> reconciler applies one owned Kubernetes Job

operator or admitted scoped product backend
  -> execd.CancelRun(nonterminal Run)
       -> commit first cancellation request
       -> auditd.RecordAuditBatch
       -> reconciler removes or terminates the owned Job
```

Intent RPC success does not mean ready. `Get*` and keyset-paginated `List*`
return stored intent and bounded observed status. Configd, provisioner,
Kubernetes, and process failures update status without creating a second
mutation API or fallback.

## Configuration and secret publication

```text
operator or admitted scoped product backend
  -> configd.PublishConfiguration | configd.PublishSecret
       -> validate invocation and policyd.CheckAccess when capability-scoped
       -> commit one immutable version
       -> auditd.RecordAuditBatch

exact configured provisioner controller at non-Global scope
  -> configd.PublishConfiguration | configd.PublishSecret(claim ID, revision)
       -> exact Kubernetes GET of the Execd-owned claim
       -> verify owner, current revision, provisioner, Placement, and Workload
       -> commit and audit one generated output

execd
  -> configd.ApplyProjection(exact version, exact consumer binding)
       -> verify Execd-owned Namespace and Workload ServiceAccount
       -> apply the convention-named ConfigMap or Secret
       -> audit semantic create or version change
  <- opaque projection metadata, never content or native coordinates
```

Configuration has one exact management read. Secret exposes metadata only.
There is no secret read, list, binding mutation, provider catalog, watch,
stream, delete, or background materialization flow.

## Browser authentication and invocation

```text
POST /auth/v1/begin(tenant_id, provider_id, return_to)
  -> authd validates exact Origin, selection, and same-origin return target
  -> authd loads the exact projected OIDC entry and creates PKCE S256 proof
  -> authd stores one browser-bound, ten-minute in-flight attempt
  <- 303 to the exact authorization endpoint with code, openid, state, and PKCE

GET /auth/v1/callback(state, code XOR error [+ error_description])
  -> authd consumes the browser-bound attempt
  -> on code: purpose-bound Egressd POST to the exact token endpoint
  -> authd validates Bearer token response and projected-key RS256 ID token
  -> purpose-bound Egressd GET to the exact UserInfo endpoint
  -> authd requires exact ID-token/UserInfo sub match
  -> identityd.CreateSession(tenant, provider, provider_subject)
       bound Authd workload bearer; no invocation JWT or account ID
       -> resolve current external identity link and Tenant standing
       -> commit Session
       -> auditd.RecordAuditBatch
  <- one-time opaque credential
  -> authd sets __Host-ctlflow-session
  <- 303 to the stored same-origin return target

authenticated application request
  -> installation ingress
  -> Execd-created Edged sidecar
       Pod-bound ctlflow-edged audience; application has no token
  -> identityd.ExchangeSession(cookie credential, exact target)
       -> validate Session, account, standing, and target
       -> sign short-lived Session-origin invocation JWT
  -> loopback product listener with Authorization: Bearer <invocation JWT>

POST /auth/v1/logout(return_to)
  -> authd validates exact Origin and opaque cookie
  -> identityd.RevokeSession(cookie credential)
       bound Authd workload bearer; no invocation JWT
       -> commit actual revocation
       -> auditd.RecordAuditBatch
  -> authd clears its cookies
  <- 303 to the validated same-origin return target
```

Authd and Edged never receive invocation-signing material. Edged never
forwards the browser credential to a product target. Authd makes no Configd
call: the purpose-bound projection is mounted before startup. Every
Authd-originated provider request crosses the selected deployed Egressd
binding; the binding is not an Egressd administration API. Unknown, malformed,
expired, mismatched, and replayed callback state fail without an Identityd
call. A valid provider error makes no Egressd call; a code result makes exactly
the token call and, only after its validation, the UserInfo call. There is no
retry, discovery, or third call. Provider or dependency failures never select
another Tenant, provider, return target, or identity.

## Controlled external HTTP

```text
consumer
  -> purpose-bound Egressd Service
       Proxy-Authorization: Bearer <bound workload token>
  -> Egressd validates exact namespace and ServiceAccount
  -> Egressd matches one configured method/path rule
  -> Egressd applies generic path/header/secret rewrites
  -> exact configured HTTPS origin
```

The caller supplies neither destination nor rule. Egressd never follows a
redirect, interprets the provider protocol, or returns a projected secret.
An unmatched request fails rather than selecting another rule or origin.

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

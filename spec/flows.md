---
title: Flows
weight: 24
---

These flows prove that the kernel services compose into complete operations. Product UIs may
replace an operator CLI as the first caller where policy permits; the owning service and operation
remain unchanged.

## Initial installation

```text
 ctlflow init
   -> load selected kubeconfig context
   -> Kubernetes API authenticates operator
   -> apply CtlFlow namespace, RBAC, API aggregation, storage, and kernel workloads
   -> wait for all kernel readiness endpoints
   -> bind authenticated Kubernetes subject as first infrastructure operator
   -> create global Placement and initial configuration
   -> close one-time initialization permanently
   -> audit successful bootstrap
```

Initialization is idempotent for the same signed release and authenticated operator. It cannot
replace an initialized operator or reset an existing installation.

## Tenant provisioning

```text
 ctlflow create tenant -f tenant.yaml
   -> Kubernetes API authenticates and authorizes operator
   -> tenantd creates Tenant in provisioning state
   -> identityd establishes initial administrator
   -> configd establishes Tenant configuration scope
   -> execd realizes canonical Tenant Placement
   -> pkgd reconciles explicitly requested baseline Apps
   -> tenantd marks Tenant active
   -> every owner delivers audit evidence
```

Each cross-service step is idempotent. A failed step leaves the Tenant visible as failed or
provisioning with one stable reason and resumes under the same operation identity. Tenant-facing
provisioning invokes the same `tenantd` use case through an admitted product backend.

## Workspace provisioning

```text
 ctlflow create workspace --tenant TENANT -f workspace.yaml
   -> tenantd creates Workspace in provisioning state
   -> identityd establishes requested Memberships
   -> configd establishes Workspace configuration scope
   -> execd realizes canonical Workspace Placement
   -> pkgd reconciles requested Workspace Apps
   -> tenantd marks Workspace active
```

A product such as a matter or deal registry separately stores its own client, stage, responsible
person, and other business metadata. `tenantd` owns only the Workspace and its lifecycle.

## Package publication and App installation

```text
 Package source or manifest
   -> pkgd validates ownership, provenance, schemas, declarations, and artifact digests
   -> optional build request asks execd for an isolated build Run
   -> built OCI digest is recorded in immutable Package version

 App installation request
   -> pkgd validates Package visibility and target Placement
   -> identityd validates attached-account standing and creates component virtual principals
   -> configd validates App and provider configuration
   -> execd admits Placement constraints
   -> execd creates dependency claims at each selected provider Placement
   -> execd waits for consumer-specific required bindings
   -> execd realizes Workloads, Services, runtime identity, storage, and network paths
   -> pkgd marks App active when required components are ready
```

Provider-specific reconciliation belongs to the selected installed controller. Service dependencies
resolve to an exact installed provider App and endpoint. Kernel dependencies resolve to their fixed
owners without provider selection.

## Login and Workspace access

```text
 browser -> edged -> identityd resolves Tenant login methods
                    -> admitted external identity provider through egressd
                    -> identityd resolves an existing identity link and User
                    -> identityd mints opaque session

 browser -> Workspace URL -> edged
                           -> identityd validates session
                           -> edged uses a bounded Workspace address-cache entry
                              or tenantd resolves it on miss/expiry
                           -> policyd verifies current standing and operation
                           -> pkgd resolves App exposure
                           -> execd resolves ready endpoint
                           -> App runtime proxy
```

Login is Tenant-scoped. A Workspace return URL does not grant Workspace Membership.

## Ordinary application request

```text
 browser -> edged
   -> validate session and external route
   -> authorize coarse App access
   -> attach trusted actor context
   -> proxy to target App runtime proxy
   -> App enforces its current object-level rules
```

CtlFlow may establish that an Actor can reach Files. Files still decides whether that Actor may
read one file. For a product management request, the target App is the product backend; it calls
the owning kernel service, which independently enforces the management operation.

## Application-to-application call

```text
 App A receives trusted Actor context
   -> App A selects declared dependency "tasks"
   -> local runtime proxy exchanges invocation handle through identityd
   -> identityd issues credential for exact Tasks endpoint
   -> Kubernetes Service routes directly to Tasks runtime proxy
   -> Tasks receives Actor, App A, runtime, Placement, and trace facts
   -> Tasks applies its own operation and object rules
```

This supports managed Tasks, object-bound discussions, notifications, directory lookups, and
cross-application aggregation without forwarding an inbound bearer or trusting identity headers.

## Product management call

```text
 browser -> edged -> product backend App
   -> backend selects declared dependency "kernel:packages"
   -> runtime proxy exchanges the trusted invocation handle through identityd
   -> pkgd receives Actor, backend principal, runtime, Placement, and exact audience
   -> pkgd authorizes and applies the same App operation used by the aggregated API
```

Kernel bindings have fixed owners and no provider selection. They do not bypass Tenant standing,
policy, Placement, or the receiving service's invariants.

## File transfer

```text
 browser -> Files App: request upload
 Files -> bound object-gateway dependency: create logical transfer
 Files -> browser: short-lived method- and path-bound URL
 browser -> exposed gateway -> object storage
 Files -> gateway: verify logical object
 Files: commit file metadata and version
```

The object gateway is a Package or provider dependency. It owns its standard protocol and physical
namespace mapping. Files owns file metadata and authorization. CtlFlow owns the dependency binding,
runtime identity, Placement isolation, exposure, and egress policy.

## Job and Run

```text
 manual caller, product service, or schedule
   -> execd Run operation
   -> validate requester and immutable Job configuration
   -> admit Placement, account, Package, dependencies, and constraints
   -> create one Run
   -> realize Kubernetes Job with workload ServiceAccount and runtime proxy
   -> each concrete attempt registers a process-specific runtime principal
   -> collect observed status, logs, and bounded output metadata
   -> commit immutable terminal outcome
```

A retry with the same idempotency identity returns the same Run.

## Product-managed agent

```text
 Chat mention or application event
   -> product event or agent-management Package matches its own activation rule
   -> invoke configured Job through declared kernel:execution binding
   -> Run receives the agent virtual principal and attached account
   -> persistent state is mounted from the Job Placement
   -> harness calls external model through egressd when admitted
   -> harness calls application services using audience-bound credentials
```

Agent templates, conversations, trigger configuration, and product logs remain product records.
`identityd` owns delegated identities and `execd` owns Jobs and Runs.

## Cross-Placement automation

```text
 Workspace application fact
   -> product automation selects a Tenant Job
   -> execd admits a Run at the Job's Tenant Placement
   -> Job calls exact Tenant service binding
   -> policyd checks virtual principal and attached account
   -> target application checks its domain rule
```

The Run does not escape its Placement. The target is permitted because the Job was independently
configured at the Tenant Placement and authorized there; no request rewrites a Workspace context
into a Tenant context.

## External HTTP

```text
 App or Run -> egressd with process-bound proxy credential
             -> establish runtime and dependency
             -> match destination, method, path, and policy
             -> obtain purpose-bound secret material from configd
             -> apply generic rewrite and upstream authentication
             -> stream request and response
```

The caller cannot select another origin, Tenant namespace, upstream credential, or physical resource
prefix.

## Audit and activity

```text
 domain mutation or security decision
   -> owner commits domain state + outbox envelope
   -> auditd ingests idempotently
   -> authorized caller queries bounded Tenant or global partition

 Run output
   -> configured log system
   -> execd exposes bounded authorized pages or finite follow stream
```

Audit evidence and program logs remain separate. Automated activity records virtual principal,
attached account, runtime principal, Placement, Run, request, and trace.

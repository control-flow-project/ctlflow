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
   -> apply CtlFlow namespace, RBAC, storage, Collector, and kernel workloads
   -> verify bounded OTLP intake and configured export
   -> wait for all kernel readiness endpoints
   -> create global Placement and initial configuration
   -> audit successful bootstrap
```

Initialization is idempotent for the same signed release. Kubernetes RBAC and installation
configuration admit operator certificate subjects; initialization does not create an operator
domain record or reset an existing installation.

## Tenant creation

```text
 ctlflow create tenant -f tenant.yaml
   -> ctlflow opens a kubeconfig-authorized port-forward to tenantd
   -> ctlflow presents the selected kubeconfig client certificate to tenantd
   -> ctlflow calls CreateTenant with a caller-generated ID, address, and display name
   -> tenantd commits the active Tenant, then records its required event through auditd
   -> tenantd returns the created Tenant
```

Creating a Tenant does not create Users, configuration, Placements, Packages, or Apps. Each of
those records is created explicitly through its owning service when needed.

## Workspace creation

```text
 ctlflow create workspace --tenant TENANT -f workspace.yaml
   -> ctlflow opens a kubeconfig-authorized port-forward to tenantd
   -> ctlflow presents the selected kubeconfig client certificate to tenantd
   -> ctlflow calls CreateWorkspace with its Tenant, caller-generated ID, address, and display name
   -> tenantd verifies the active parent Tenant
   -> tenantd commits the active Workspace, then records its required event through auditd
   -> tenantd returns the created Workspace
```

A product such as a matter or deal registry separately stores its own client, stage, responsible
person, and other business metadata. `tenantd` owns only the Workspace record and state.

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
 browser -> authd
   -> tenantd resolves the exact Tenant root
   -> tenantd separately resolves a Workspace return segment when present
   -> identityd resolves admitted Tenant login methods
   -> identityd uses admitted external identity provider through egressd
   -> identityd resolves an existing identity link, User, and Membership
   -> identityd creates opaque Session
   -> authd sets secure Session cookie and returns to validated destination

 browser -> Workspace URL -> edged
                           -> resolve cached invocation JWT or ask identityd to validate Session
                              and issue one
                           -> edged uses a bounded Tenant address-cache entry
                              or tenantd resolves it on miss/expiry
                           -> edged uses a separate bounded Workspace address-cache entry
                              or tenantd resolves it inside that Tenant on miss/expiry
                           -> policyd verifies current standing and operation
                           -> pkgd resolves App exposure
                           -> execd resolves ready endpoint
                           -> App runtime proxy validates edged workload + invocation JWT
```

Login is Tenant-scoped. A Workspace return URL does not grant Workspace Membership.

## Ordinary application request

```text
 browser -> edged
   -> resolve Session to invocation JWT and validate external route
   -> authorize coarse App access
   -> start or continue W3C trace
   -> proxy to target App runtime proxy
   -> runtime proxy validates edged workload and invocation JWT
   -> inject trusted Actor and trace context
   -> App enforces its current object-level rules
```

CtlFlow may establish that an Actor can reach Files. Files still decides whether that Actor may
read one file. For a product management request, the target App is the product backend; it calls
the owning kernel service, which independently enforces the management operation.

## Application-to-application call

```text
 App A receives trusted Actor context
   -> App A selects declared dependency "tasks"
   -> local runtime proxy resolves the existing Tasks binding
   -> proxy presents App A workload token and propagates the invocation JWT
   -> proxy injects current W3C trace context
   -> Kubernetes Service routes directly to Tasks runtime proxy
   -> Tasks validates workload and invocation independently
   -> Tasks receives Actor, App A, runtime, Placement, and trace facts
   -> Tasks applies its own operation and object rules
```

This supports managed Tasks, object-bound discussions, notifications, directory lookups, and
cross-application aggregation without forwarding a browser credential or trusting identity
headers.

## Product management call

```text
 browser -> edged -> product backend App
   -> backend selects declared dependency "kernel:packages"
   -> runtime proxy presents its workload token and propagates the invocation JWT
   -> pkgd validates both identities and receives Actor, backend principal, runtime, and Placement
   -> pkgd authorizes and applies the requested App operation
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
   -> runtime proxy obtains a fresh invocation JWT for the admitted Run
   -> harness calls external model through egressd when admitted
   -> harness calls application services through its runtime proxy
   -> proxy presents the Run workload token and invocation JWT
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
 App or Run -> binding-specific egressd HTTP endpoint
             -> validate process-and-dependency-bound proxy credential
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
 contract-required mutation or security outcome
   -> owner establishes the outcome
   -> owner calls auditd directly
   -> auditd ingests idempotently
   -> authorized caller queries bounded Tenant or global partition

 stateless ingress or egress allow
   -> auditd accepts required decision evidence
   -> mediator reports success or forwards the admitted result

 Run output
   -> configured log system
   -> execd exposes bounded authorized pages or finite follow stream
```

Audit evidence and program logs remain separate. Automated activity records virtual principal,
attached account, runtime principal, Placement, Run, invocation-token ID, trace, and span.

## Telemetry

```text
 authd or edged starts or continues W3C trace context
   -> every internal HTTP/gRPC hop extracts and injects traceparent/tracestate
   -> delayed Run starts a linked trace
   -> each process exports bounded OTLP asynchronously
   -> installation OpenTelemetry Collector processes and exports
```

Collector failure cannot fail the operation or satisfy required audit evidence. External baggage,
credentials, payloads, and prohibited high-cardinality metric dimensions are never propagated or
exported.

---
title: Contracts
weight: 22
---

This page defines the approved connections between kernel services. Ownership
pages do not create additional calls.

## Private transport

Every private workload gRPC call carries:

```text
authorization: Bearer <bound Kubernetes workload token>
ctlflow-invocation: Bearer <invocation JWT>   when acting on behalf of an Actor
traceparent: <W3C trace context>
tracestate: <W3C vendor state>                optional
```

The workload token establishes the immediate caller. The invocation JWT
establishes subject account, Actor, Tenant, optional Workspace, and origin
facts. Each receiver validates both independently and ignores caller-supplied
fields that attempt to replace them.

An infrastructure-operator call instead authenticates the end-to-end
kubeconfig client certificate admitted by the owning operation. It carries
trace context but no workload token or invocation JWT. Ambiguous mixed
credentials are rejected.

Every call has a finite deadline, propagates cancellation, and uses private
TLS. A caller never holds a database transaction while making a dependency
call.

`identityd.GetInvocationVerificationKeys` is a bootstrap operation: it carries
workload authentication and trace context but no invocation JWT.
Receivers use its result to validate an invocation whose key is not in their
current cache. Identityd fact operations still receive and independently
validate the unchanged invocation.

Identityd Session and issuance operations also omit an existing invocation.
They establish identity from an exact admitted workload plus either a
validated external identity, opaque Session credential, or Execd-owned Run
request as defined by their individual contracts.

## Tenant capability authorization

A product backend calls an approved capability-enabled Tenantd operation with
its own workload token and the unchanged invocation JWT.

```text
product backend
  -> tenantd
       -> policyd.CheckAccess
            -> identityd.GetInvocationVerificationKeys
            -> identityd.ResolvePrincipal
            -> identityd.ListPrincipalGroups
       -> tenantd Domain operation
       -> auditd.RecordAuditBatch   mutation only
```

Tenantd:

1. authenticates the exact admitted backend;
2. validates the invocation JWT;
3. applies the Tenant and Workspace fence;
4. constructs the operation and resource path from validated domain IDs;
5. calls `CheckAccess` as `SERVICE/svc_tenantd`; and
6. applies an allow only to the current call.

Policyd authenticates Tenantd, verifies that Tenantd owns the operation,
validates the same invocation independently, and obtains current principal,
attached-account, standing, and direct-Group facts from Identityd.

A human or service Actor needs one matching direct or direct-Group allow. A
virtual Actor additionally requires the same authority for its immutable
attached account. No-match is deny. Missing current standing is `NOT_FOUND`.
Identity or policy dependency failure is `UNAVAILABLE`.

Operator-only and autonomous-kernel Tenantd operations remain separate
admission paths and do not manufacture a capability Actor.

## Tenant and Workspace resolution

`ResolveTenant` receives one Tenant address and returns canonical Tenant ID,
state, and revision only for an active Tenant.

`ResolveWorkspace` receives canonical parent Tenant ID and one Workspace
address. It returns canonical Workspace ID, state, and revision only when both
Workspace and parent Tenant are active.

The external hierarchy is:

```text
/tenants/<tenant-address>
/tenants/<tenant-address>/workspaces/<workspace-address>
```

Infrastructure owns the external authority. Tenantd owns the two address
segments and parent relationship. A caller may cache a bounded projection, but
Tenantd owns no cache controls, binding generation, route, or cursor state.

## Package declarations and App intent

Infrastructure operators call Pkgd directly through the certificate-backed
private gRPC path:

```text
operator
  -> pkgd.DeclarePackage
       -> auditd.RecordAuditBatch

operator
  -> pkgd.CreateApp or pkgd.SetAppPackageGeneration
       -> auditd.RecordAuditBatch
```

The operator certificate supplies attribution and authority. These operations
carry no invocation JWT and perform no Identityd or Policyd call. Pkgd commits
one immutable Package generation or one App-intent mutation, releases its
transaction, and delivers the required audit fact before returning success.

Configured product backends use the capability path only for Tenant,
Workspace, or User App operations:

```text
product backend
  -> pkgd.CreateApp, pkgd.GetApp, or pkgd.SetAppPackageGeneration
       -> identityd.GetInvocationVerificationKeys
       -> policyd.CheckAccess
       -> auditd.RecordAuditBatch                 mutation only
```

Pkgd validates the invocation independently, derives the exact `apps.*`
operation and scope path, forwards the unchanged invocation to Policyd, and
applies an allow only to the current call. Global Apps have no capability
path.

Execd reads exact realization input over the production private gRPC path:

```text
execd
  -> pkgd.GetApp
  -> pkgd.GetPackage
```

Execd authenticates as `SERVICE/svc_execd` and carries no invocation JWT.
Pkgd does not validate Tenant, Workspace, account, or Placement existence by
reading another owner's records.

## Invocation verification

Tenantd, Pkgd, Configd, and Policyd load public invocation keys with
`identityd.GetInvocationVerificationKeys`. They cache the exact bounded key set
only until its supplied expiry and refresh on expiry or an unknown key ID.

Policyd uses `ResolvePrincipal` and all pages of `ListPrincipalGroups` at the
exact target. These operations return identity facts only. They never return a
Role, grant, operation, resource path, or decision.

Identityd independently validates the unchanged invocation JWT on both fact
operations. `ResolvePrincipal` admits only the invocation Actor.
`ListPrincipalGroups` admits that Actor and, for a virtual invocation, its
immutable attached subject account. Identityd re-establishes current
attachment, target standing, and both invocation and virtual-principal fences
on every page.

## Session and invocation issuance

```text
authd -> purpose-bound Egressd binding -> configured OIDC token endpoint
  <- bounded token response
authd -> same purpose-bound Egressd binding -> configured UserInfo endpoint
  <- bounded UserInfo response

validated matching OIDC subject
  -> authd
       -> identityd.CreateSession
            -> auditd.RecordAuditBatch
       <- one-time opaque Session credential

browser cookie
  -> edged
       -> identityd.ExchangeSession
       <- short-lived Session-origin invocation JWT

admitted Run
  -> execd
       -> identityd.IssueRunInvocation
       <- short-lived Run-origin invocation JWT

logout credential
  -> authd
       -> identityd.RevokeSession
            -> auditd.RecordAuditBatch   actual mutation only
```

Authd never names an account. Identityd resolves the current external identity
link and standing before creating a Session. Edged never names an account or
Actor. Execd names the Actor attached to its Run but never names an attached
account. Identityd alone derives `sub`, optional `act.sub`, issuer, audience,
origin, times, and key.

Session credentials never leave Authd, the browser cookie, Edged, and
Identityd. Invocation-signing private material never leaves Identityd.
Authd receives provider settings and credentials only from the Configd-owned,
purpose-bound deployed projection defined by Authd; it makes no Configd call.
All Authd-originated provider HTTP crosses the deployed purpose-bound Egressd
endpoint. Authd owns the sole OIDC Authorization Code with PKCE profile; the
binding creates no Egressd administration or callable kernel method.

## Configuration, secrets, and projection

An admitted product backend may use Configd's scoped management operations
only with a validated invocation and Configd-owned policy decision:

```text
product backend -> configd + invocation
  -> identityd.GetInvocationVerificationKeys
  -> policyd.CheckAccess
  -> auditd.RecordAuditBatch after an actual publication
```

Provider-generated output uses a separate non-Global autonomous path:

```text
exact provisioner controller
  -> configd.PublishConfiguration | configd.PublishSecret(
       dependency_claim_id, dependency_claim_revision)
       -> exact Kubernetes GET of Execd-owned dependency claim
       -> verify owner, current revision, provisioner, Placement, and Workload
  -> auditd.RecordAuditBatch after an actual publication
```

Static workload configuration authenticates only the exact controller
ServiceAccount and provisioner. The opaque claim ID and positive revision
select current Execd-owned evidence but grant no authority. Configd holds no
transaction across the GET and owns no claim table, registration, list, or
watch.

Global management remains operator-only. Execd is the sole autonomous
projection caller:

```text
execd
  -> configd.ApplyProjection(
       Configuration(identity, exact version) | Secret(identity, exact version),
       exact consumer binding)
  <- opaque projection ID, target, binding, revision, and times
```

The binding contains one Placement ID with exactly one Global, Tenant,
Workspace, or User scope, plus consumer and purpose. On a User-scope
capability call, its account must equal validated invocation `sub`. Execd
receives neither configuration bytes, secret material, nor native coordinates.

### Deterministic realization convention

This is the sole native-name algorithm shared by Execd and Configd. Each owner
defines a fixed ASCII domain, semantic ID, and DNS prefix. `field(s)` is the
four-byte unsigned big-endian length of `UTF8(s)` followed by those exact
bytes. Inputs are validated first and receive no normalization:

```text
field(s) = uint32be(byte_length(UTF8(s))) || UTF8(s)

native_preimage = ASCII(domain) || 0x00 || field(id)
native_token = lowerhex(first16(SHA256(native_preimage)))
native_name = prefix || native_token
```

`first16` means the first 16 digest bytes in digest order. Execd applies this
function to its `plc-` Placement Namespace and `wld-` Workload ServiceAccount.
Configd consumes those owner rules and cannot replace them.

The exact Execd-owned names consumed by Configd are:

```text
placement_namespace = "plc-" || native_token(
  "ctlflow.execution.v1.PlacementNamespace", placement_id)
workload_service_account = "wld-" || native_token(
  "ctlflow.execution.v1.WorkloadServiceAccount", workload_id)
```

Both objects carry
`execution.ctlflow.io/owner-service=execd` and
`execution.ctlflow.io/placement-id=<placement_id>`. The ServiceAccount also
carries `execution.ctlflow.io/workload-id=<workload_id>`. Configd requires
those exact annotations and names; absence or disagreement is not ownership.

Execd dependency claims use namespaced
`execution.ctlflow.io/v1`, kind `DependencyClaim`, plural
`dependencyclaims`. The claim name is its canonical `dpc-<32-lower-hex>` ID,
and it lives in the derived Placement Namespace. Its exact Configd-consumed
shape is:

```yaml
metadata:
  annotations:
    execution.ctlflow.io/owner-service: execd
spec:
  claimRevision: <positive uint64>
  placementId: <canonical placement ID>
  workloadId: <canonical workload ID>
  provisionerSubject: system:serviceaccount:<namespace>:<service-account>
```

Configd performs one namespaced GET and validates every listed value. It does
not list, watch, mutate, cache, or infer a claim and does not treat the
resource as its own API.

One Configd projection exists per exact `(data kind, ConsumerBinding)` semantic
key. Binding includes Placement ID, closed scope and anchors, consumer ID, and
purpose. Target identity and version are excluded from projection identity;
the first target identity remains immutable while the selected version may
change. Projection generation 1 uses:

```text
projection_preimage =
  ASCII("ctlflow.configuration.v1.Projection") || 0x00
  || kind_tag
  || field(placement_id)
  || scope_tag
  || scope_fields
  || field(consumer_id)
  || field(purpose)
```

`kind_tag` is one byte: configuration `0x01`, secret `0x02`.
`scope_tag` and `scope_fields` are:

| Scope | Tag | Fields in order |
| --- | --- | --- |
| Global | `0x01` | none |
| Tenant | `0x02` | `field(tenant_id)` |
| Workspace | `0x03` | `field(tenant_id)`, `field(workspace_id)` |
| User | `0x04` | `field(tenant_id)`, `field(account_principal_id)` |

The digest is the lower-case, unpadded RFC 4648 base32 encoding of the full
SHA-256 digest. It is exactly 52 characters from `[a-z2-7]`:

```text
projection_id = "prj_" || digest
object_name = "prj-" || native_token(
  "ctlflow.configuration.v1.ProjectionObject", projection_id)
```

Configuration uses a ConfigMap with exactly one `data["content"]` entry.
Secret uses an `Opaque` Secret with exactly one `data["content"]` entry.
Both objects live in the derived Placement Namespace, use the derived object
name, and carry exactly these ownership annotations:

```text
configuration.ctlflow.io/owner-service=configd
configuration.ctlflow.io/projection-id=<projection_id>
execution.ctlflow.io/placement-id=<placement_id>
execution.ctlflow.io/workload-id=<consumer_id>
```

Each object has one non-controller owner reference to the exact Workload
ServiceAccount returned by Configd's prerequisite GET: core `v1`,
`ServiceAccount`, exact derived name and current UID, `controller=false`, and
`blockOwnerDeletion=false`. Configd never adopts an object whose name,
namespace, kind, ownership annotations, or owner reference disagrees. Such a
collision is `ALREADY_EXISTS`.

Configd creates or server-side applies with field manager `ctlflow-configd`.
After proving the exact name, kind, ownership annotations, and owner reference,
it may force-apply only its owned payload and exact ownership shape to repair
drift. It never uses force to adopt or rewrite an ownership collision, and
requires the returned payload to contain only the exact `content` entry.
Disagreeing ownership or another payload entry is an `ALREADY_EXISTS`
collision rather than an object Configd may overwrite. Execd mounts that key
read-only at exactly:

```text
configuration  /run/ctlflow/configurations/<purpose>/content
secret         /run/ctlflow/secrets/<purpose>/content
```

No namespace, object name, key, path, or material enters gRPC, and no caller
selects or overrides one.

## Audit delivery

After an audited mutation commits and no transaction is held, the source calls
`auditd.RecordAuditBatch` directly.

```text
listed committed mutation -> source service -> auditd
```

The authenticated source and source event ID make an identical replay
idempotent. A replay with different canonical event content is
`ALREADY_EXISTS`. The source stores no audit outbox, queue, journal, cursor,
delivery worker, or fallback copy.

Reads, rejected calls, and no-op mutations create no successful mutation
event. A contract-defined retry may redeliver the exact same source event; an
idempotent Auditd acceptance is not a new event. Identityd audits only
successful Session creation and an actual Session revocation. The exact
audited mutations for Tenantd, Identityd, Pkgd, Configd, and Execd are closed
by their owner contracts and the Auditd detail inventory.

## Complete call inventory

| Caller | Callee | Purpose |
| --- | --- | --- |
| `tenantd` | `identityd.GetInvocationVerificationKeys` | Validate invocation JWTs |
| `tenantd` | `policyd.CheckAccess` | Authorize one Tenantd capability |
| `tenantd` | `auditd.RecordAuditBatch` | Record one committed Tenant or Workspace mutation |
| `pkgd` | `identityd.GetInvocationVerificationKeys` | Validate invocation JWTs |
| `pkgd` | `policyd.CheckAccess` | Authorize one scoped App capability |
| `configd` | `identityd.GetInvocationVerificationKeys` | Validate invocation JWTs |
| `configd` | `policyd.CheckAccess` | Authorize one scoped configuration or secret capability |
| `policyd` | `identityd.GetInvocationVerificationKeys` | Independently validate the invocation |
| `policyd` | `identityd.ResolvePrincipal` | Obtain current exact-target identity and standing facts |
| `policyd` | `identityd.ListPrincipalGroups` | Obtain bounded pages of direct Group IDs |
| `authd` | `identityd.CreateSession` | Resolve a validated external identity and create one Session |
| `authd` | `identityd.RevokeSession` | Revoke one Session by opaque credential |
| `edged` | `identityd.ExchangeSession` | Exchange one current Session for an exact-target invocation |
| `execd` | `identityd.IssueRunInvocation` | Issue an exact-target invocation for one owned Run |
| `execd` | `pkgd.GetApp` | Read one authoritative installed App intent |
| `execd` | `pkgd.GetPackage` | Read one immutable Package generation |
| `execd` | `configd.ApplyProjection` | Ensure one exact version for a bound consumer |
| Provisioner controller | `configd.PublishConfiguration` | Publish one exact claim-bound configuration output |
| Provisioner controller | `configd.PublishSecret` | Publish one exact claim-bound secret output |
| `identityd` | `auditd.RecordAuditBatch` | Record one committed Session creation or actual revocation |
| `pkgd` | `auditd.RecordAuditBatch` | Record one committed Package or App mutation |
| `configd` | `auditd.RecordAuditBatch` | Record one committed publication or Projection mutation |
| `execd` | `auditd.RecordAuditBatch` | Record one committed Placement, Workload, or Run mutation |

No other kernel-to-kernel call is approved by this specification.

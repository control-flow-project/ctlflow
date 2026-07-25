---
title: tenantd
weight: 40
---

`tenantd` is the authority for the Tenant and Workspace hierarchy and lifecycle.

## Owns

| Record | Scope |
| --- | --- |
| Tenant | CtlFlow installation |
| Workspace | Exactly one Tenant |
| Tenant address binding | Exactly one Tenant |
| Workspace address binding | Exactly one Workspace |
| Lifecycle operation and step acknowledgement | Exactly one Tenant or Workspace generation |

It serves `tenants` and `workspaces` in `tenancy.ctlflow.com/v1alpha1`.

## Activities

- Create, read, list, update, suspend, resume, and delete Tenants.
- Create, read, list, update, suspend, resume, and delete Workspaces.
- Allocate opaque IDs and validate bounded display names and unambiguous address segments.
- Own admitted host and path address bindings for Tenants and Workspaces.
- Resolve an exact external Tenant or Workspace address to its canonical ID.
- Return a revision and finite cache expiry with each external address resolution.
- Track provisioning generation, lifecycle, conditions, and bounded failure reasons.
- Coordinate initial administrator, configuration scope, canonical Placement, and explicitly
  requested baseline Apps.
- Stop new child activity before suspension or deletion proceeds.
- Coordinate idempotent cleanup acknowledgements from every owner of child records.

## Provisioning

Tenant creation atomically persists the Tenant, permanent address binding, immutable creation
intent, current lifecycle operation, four assigned owner steps, resource event, and audit outbox
intent. The initial state is `provisioning`.

```text
 identityd  establish initial administrator
 configd    establish Tenant configuration scope
 execd      realize canonical Tenant Placement
 pkgd       reconcile requested baseline Apps
```

Workspace creation uses the same transaction shape and assigns:

```text
 identityd  establish requested Memberships
 configd    establish Workspace configuration scope
 execd      realize canonical Workspace Placement
 pkgd       reconcile requested Workspace Apps
```

Each owner authenticates to `tenantd`, lists or watches only its own pending steps, commits its
local result under the supplied operation identity, and acknowledges complete or blocked. Delivery
is at least once; owner work and acknowledgement are independently idempotent. `tenantd` never
calls a child owner or holds a transaction across a network call. Completing the fourth required
step advances the resource to `active` in the acknowledgement transaction.

The caller may be the operator CLI or an admitted product backend. Tenant creation carries one
typed initial-human-administrator declaration and an explicit finite baseline App set. Workspace
creation carries an explicit finite Membership set for existing Tenant Users and an explicit
finite baseline App set. Secret material, credentials, and provider tokens never pass through
`tenantd`. Business metadata such as matter type, pipeline stage, client, or responsible person
belongs to the calling product application.

Each owner reconciliation starts only after the local transaction commits. The provisioning
generation and idempotency identity make retry safe. A failed step leaves one visible condition and
never creates a second Tenant or Workspace.

## External address model

An external address binding is permanent ownership of one canonical public root. A Tenant binding
contains:

```text
authority
Tenant path prefix
Tenant ID
binding generation
active or retired state
```

The authority is lower-case ASCII DNS form without scheme, user information, port, or trailing dot.
The Tenant path prefix is either `/` for a host-root Tenant or
`/tenants/<tenant-address>` on a shared host. A Tenant address is one lower-case unreserved path
segment. Fixed structural segments and user-controlled address segments occupy different positions,
so no user value competes with `tenants`, `workspaces`, authentication routes, or application route
families.

A Workspace address binding contains one Workspace address segment inside one Tenant. Its public
root is:

```text
<Tenant root>/workspaces/<workspace-address>
```

Tenant and Workspace address segments are publication keys, not record IDs. They are unique only in
their declared parent address scope and never determine ownership or authorization.

An `(authority, Tenant path prefix)` is bound to exactly one Tenant for the installation's
lifetime. A Workspace address is bound to exactly one Workspace for the lifetime of its parent
Tenant. Retiring a binding makes external resolution return not found but does not release the
address. The bound Tenant or Workspace is immutable, and there is no operation that repoints or
reactivates a retired binding.

Tenant and Workspace deletion leaves terminal owner tombstones and all address reservations in
place. Foreign-key deletion is restrictive; neither an administrative delete nor storage
maintenance can cascade away an address reservation.

## ResolveTenant contract

`ctlflow.tenancy.v1.TenantService.ResolveTenant` is the direct lookup used by `edged` and admitted
kernel services. Its request contains two independently presence-tracked selector fields and
requires exactly one:

```text
tenant_id

or

external_address:
  authority
  path_prefix
```

`tenant_id` is an opaque canonical Tenant ID matching
`[a-z0-9][a-z0-9_-]{0,63}`. `external_address` is the exact canonical Tenant root described above.
The caller canonicalizes the external request before lookup; `tenantd` rejects rather than rewrites
non-canonical input.

ID lookup returns an existing Tenant in any retained lifecycle state. External-address lookup
returns only an active address binding whose Tenant is active. There is no alias, ancestor,
nearest-match, or fallback resolution.

The response contains only:

```text
canonical Tenant ID
Tenant lifecycle
Tenant revision
optional matched address-binding generation
cache expiry
```

The cache expiry is computed from server time and the configured positive lifetime, which must be
between one and 60 seconds. It is never stored as Tenant state. The response does not expose display
name, conditions, internal database identity, or another administrative field.

| Outcome | gRPC status |
| --- | --- |
| Missing selector, multiple selectors, malformed ID, or non-canonical address | `INVALID_ARGUMENT` |
| No visible retained ID or active external-address binding | `NOT_FOUND` |
| Missing, invalid, or expired Kubernetes workload token | `UNAUTHENTICATED` |
| Authenticated workload not admitted to resolve Tenants | `PERMISSION_DENIED` |
| Schema or required local persistence unavailable | `UNAVAILABLE` |

Every call requires an authenticated bound Kubernetes ServiceAccount token. An invocation JWT is
optional because address resolution may occur before a human Session is established. Valid W3C
trace context is continued; an absent or malformed parent starts a new trace as required by
[Telemetry](../telemetry/). A valid invocation Tenant fence that excludes the resolved Tenant makes
the result not found. An invalid invocation JWT is unauthenticated; token claims that assert roles,
permissions, scopes, endpoints, or trace context are invalid. Caller identity cannot be supplied in
the request body.

Canonical evidence covers:

- ID lookup for every retained Tenant lifecycle and exact not-found behavior;
- active external-address lookup and invisibility of inactive bindings or inactive Tenants;
- every malformed, missing, and multiple-selector result;
- bound workload authentication, token failure, and caller admission;
- absent, valid, malformed-context, invalid, expired, and cross-Tenant invocation JWT behavior;
- valid trace continuation, malformed-parent replacement, redaction, and bounded Collector outage;
- exact schema-ledger and migration-lock compatibility, migrated file-backed SQLite, restart,
  deadline, and cancellation; and
- the configured one-to-60-second expiry bound through the shipping production process.

## ResolveWorkspace contract

`ctlflow.tenancy.v1.TenantService.ResolveWorkspace` is a separate lookup performed only after
`ResolveTenant` succeeds. Its request contains:

```text
canonical Tenant ID
Workspace address segment
```

The Workspace address is the exact segment following the fixed `/workspaces/` boundary. It cannot
contain a slash, encoded separator, dot segment, empty segment, or non-canonical escaping. The
operation never accepts an authority, chooses a Tenant, or searches another Tenant.

The response contains only:

```text
canonical Workspace ID
Workspace lifecycle
Workspace revision
matched Workspace address-binding generation
cache expiry
```

Resolution returns only an active Workspace binding whose bound Workspace is active and whose
parent Tenant is both the request Tenant and active. A binding never resolves a Workspace owned by
another Tenant even if a stored row names a mismatched pair.

Malformed input is `INVALID_ARGUMENT`; no visible active binding is `NOT_FOUND`; authentication,
admission, persistence, tracing, and the one-to-60-second expiry bound follow `ResolveTenant`. In
addition to the Tenant fence, a valid invocation whose Workspace scope excludes the resolved
Workspace makes the result not found, so a Workspace-scoped credential cannot resolve a sibling
Workspace in the same Tenant. There is no alias, fallback, or nearest-Workspace match.

## Administrative resources

The aggregated HTTPS listener serves only
`/apis/tenancy.ctlflow.com/v1alpha1`. Kubernetes API aggregation authenticates
and authorizes the operator before proxying the request. `tenantd` accepts the
forwarded `X-Remote-User` actor only on this listener and only when the
connection presents a client certificate chaining to the configured
request-header client CA with an explicitly admitted client name. The body
cannot supply or override the actor. The direct gRPC and probe listeners never
accept forwarded identity headers.

Request documents use strict JSON: unknown members, duplicate set entries,
missing required values, non-canonical IDs, and values outside declared bounds
are invalid. Successful and failed responses follow Kubernetes JSON
content-negotiation conventions. Failures are Kubernetes `Status` documents
with a stable reason, HTTP code, safe message, and field causes where a request
field is invalid; persistence and provider details are never returned.
Every request document requires `Content-Type: application/json` and has a
256 KiB maximum encoded body, enforced while streaming independently of
`Content-Length`. Another media type is unsupported and an oversized fixed-
length or chunked body is rejected before deserialization.

Canonical administrative fields use these exact bounds:

| Field | Admitted value |
| --- | --- |
| Tenant ID, Workspace ID, User ID, Package ID, provider ID | One to 64 lower-case ASCII characters; starts alphanumeric; remainder alphanumeric, `_`, or `-` |
| Tenant, Workspace, or administrator display name | One to 200 characters and not whitespace-only |
| Login identifier | One to 320 characters and not whitespace-only |
| Provider subject | One to 512 characters and not whitespace-only |
| Package version | One to 128 characters and not whitespace-only |
| External authority | Lower-case ASCII DNS form, at most 253 characters, with one-to-63-character labels |
| Tenant path prefix | `/` or `/tenants/<address>`, where address is a one-to-63-character lower-case unreserved segment other than `.` or `..` |
| Workspace address | One-to-63-character lower-case unreserved segment other than `.` or `..` |
| `Idempotency-Key` | One to 128 ASCII letters, digits, `.`, `_`, `:`, or `-` |
| Blocked reason | One to 200 characters and not whitespace-only |

A Tenant create request contains bounded display metadata, one permanent external-address
publication request, one initial-administrator declaration, and an explicit finite set of baseline
App installation requests. A Workspace create request contains its immutable parent Tenant,
bounded display metadata, one permanent Workspace address, an explicit finite initial Membership
set, and an explicit finite baseline App set. Initial administrator, Membership, and App inputs are
persisted provisioning intent; they never become `tenantd`-owned identity or Package records.

The initial administrator contains bounded display and login identifiers plus an optional exact
provider-ID and provider-subject link; it never contains a password, token, or Secret. A baseline
entry is exactly a Package ID and immutable version. A Workspace Membership entry is exactly a
Tenant User ID and `admin` or `member` standing. Duplicate entries are invalid. One create admits at
most 64 baseline Packages and 256 initial Workspace Memberships. Administrative list pages admit
one to 100 resources.

Tenant and Workspace resources expose:

```text
metadata:
  name: opaque Tenant or Workspace ID
  resourceVersion: database-wide resource-event sequence

spec:
  immutable parent, when Workspace
  display name
  immutable external address publication
  explicit provisioning inputs

status:
  lifecycle
  positive revision
  positive provisioning generation
  current lifecycle operation
  one bounded condition per incomplete owner step
```

Create allocates the opaque ID and permanent address binding in the same transaction. Update may
change only admitted display metadata and requires the current `metadata.resourceVersion`. Address,
parent, initial provisioning inputs, and canonical Placement identity are immutable. Baseline Apps
after creation are managed as `pkgd` Apps rather than by editing the Tenant or Workspace.
Display metadata remains editable in `provisioning`, `active`, `suspending`, `suspended`,
`resuming`, and `failed`; `deleting` and `deleted` reject updates. A syntactically valid update that
differs in an immutable field is a semantic rejection rather than a malformed document.

`metadata.resourceVersion` and `status.revision` are deliberately distinct. The former is the
database-wide resource-event sequence used by optimistic mutation preconditions, list snapshots,
and watches. The latter is the positive owner-local revision returned by direct lifecycle and
address-resolution operations. Every accepted mutation advances both values atomically.

Each incomplete owner step appears as one status condition with the owner step, `pending` or
`blocked` state, optional owner revision, optional bounded blocked reason, and transition time.
Completed steps are absent. A reason is present exactly for `blocked`.

`suspend`, `resume`, `retry`, and `delete` are explicit subresources. Repeating one with the same
idempotency identity and canonical body returns the same lifecycle operation; reuse with another
body is a conflict. Exactly one lifecycle operation is current for a resource.

```text
 create     -> provisioning -> active
 active     -> suspending   -> suspended
 suspended  -> resuming     -> active
 stable or failed -> deleting -> deleted
 blocked owner step -> failed
 retry -> the transitional state for the same operation and generation
```

Delete is irreversible and reaches terminal `deleted` only after every required owner acknowledges
retired child state. A Tenant cannot enter deletion while it owns a non-deleted Workspace. Tenant
suspension does not rewrite each Workspace record; the non-active parent fences every Workspace
operation and child owner. Workspace creation and resumption require an active parent Tenant.

Every mutation increments the resource revision and one database-wide resource-event sequence in
the same transaction. A list page is ordered by opaque ID and fixed to the sequence returned on its
first page. Its opaque continuation is bound to the authenticated visibility fence, selectors,
last ID, and that sequence. If a mutation makes the snapshot unavailable, continuation fails as
expired instead of mixing revisions. Watches start strictly after an explicit sequence, emit
bounded `ADDED` or `MODIFIED` snapshots, and end on deadline, cancellation, compaction, or the
configured maximum lifetime. Terminal tombstones remain listable and produce a final `MODIFIED`
event rather than disappearing.

List requests accept `limit` and `continue`; a first page has no continuation,
and a continuation cannot be combined with a cursor or a changed selector.
Workspace lists require exactly one `spec.tenantId=<canonical Tenant ID>`
selector on every page; a continuation must repeat that exact selector. Watch
requests require `watch=true` and an explicit non-negative
`resourceVersion`; they reject list-only `limit` and `continue` parameters.
Watch responses are newline-delimited Kubernetes watch envelopes. Each
envelope is `ADDED` or `MODIFIED` with the complete typed resource. An
`ERROR` envelope contains a Kubernetes `Status` and terminates the stream.

Collection and watch cursors are non-negative: `0` means no resource event has yet committed and is
the valid starting cursor for an empty installation. An individual object's
`metadata.resourceVersion`, owner-local revision, and provisioning generation are always positive.

Mutation outcomes use these Kubernetes HTTP results:

| Outcome | HTTP status and reason |
| --- | --- |
| Create accepted | `201 Created` |
| Update found and accepted | `200 OK` |
| Lifecycle change or delete accepted | `202 Accepted` |
| Malformed document, selector, cursor, or field | `400 Invalid` |
| Missing aggregation identity | `401 Unauthorized` |
| Exact retained target absent | `404 NotFound` |
| Encoded request body exceeds 256 KiB | `413 Invalid` |
| Request document is not `application/json` | `415 Invalid` |
| Permanent address or idempotency conflict | `409 AlreadyExists` |
| Resource-version race | `409 Conflict` |
| Well-formed update changes an immutable field | `422 Invalid` |
| Current lifecycle, parent state, or owned children forbid the operation | `422 Invalid` |
| Expired continuation or compacted watch cursor | `410 Expired` |
| Schema or required persistence unavailable | `503 ServiceUnavailable` |

Every mutation requires one canonical `Idempotency-Key`. The same
authenticated actor, operation, key, and canonical semantic input returns the
original result. Reusing that tuple for another input is `409 AlreadyExists`.
An update or lifecycle action requires the current positive
`resourceVersion`; stale versions are `409 Conflict`.

## Lifecycle fact contract

`GetLifecycle` receives exactly one canonical target:

```text
Tenant ID

or

Tenant ID + Workspace ID
```

It returns the canonical target, parent Tenant when applicable, lifecycle, record revision,
provisioning generation, and an expiry no later than 60 seconds. It returns any retained lifecycle
state, including terminal tombstones. A mismatched Workspace parent or an invocation fence outside
the target is `NOT_FOUND`. This is the only narrow lifecycle projection consumed by other kernel
services; they do not cache or copy Tenant or Workspace administrative records.

## Lifecycle acknowledgement contract

`AcknowledgeLifecycleStep` records one downstream owner's result for one current provisioning,
suspension, resumption, or deletion generation. Its request contains:

```text
target Tenant or Workspace
lifecycle-operation ID and provisioning generation
step key assigned by tenantd
downstream owner revision
outcome: complete or blocked
bounded stable reason when blocked
idempotency key
```

The authenticated immediate service determines the downstream owner; a body cannot name another
owner. `tenantd` accepts only a step assigned to that service and generation. The same
idempotency key and canonical result returns the existing acknowledgement. A stale generation or
operation is `FAILED_PRECONDITION`; a conflicting retry is `ALREADY_EXISTS`; a revision race is
`ABORTED`.

The response returns the accepted step state, Tenant or Workspace lifecycle, provisioning
generation, and current record revision. Completing the final required step advances lifecycle in
the same transaction. A blocked step records one bounded condition and leaves the operation
retryable. No acknowledgement can skip another required owner, resurrect deletion, or mutate the
downstream record.

## Lifecycle work contract

`ListLifecycleSteps` and `WatchLifecycleSteps` expose only work assigned to the authenticated
immediate owner. The body cannot request another owner. The admitted owners are exactly
`identityd`, `configd`, `execd`, and `pkgd`; each installation binds those names to exact
Kubernetes ServiceAccount subjects.

Each delivered step contains:

```text
delivery sequence
target Tenant or Workspace
lifecycle-operation ID and provisioning generation
stable step key
desired lifecycle
typed owner-specific creation intent, when provisioning
step state and bounded blocked reason
```

Each delivery is permanently bound to one retained lifecycle operation and to
the exact step within that operation. Durable storage enforces both bindings;
a delivery cannot outlive, switch, or disagree with either owner.

Identity work carries the initial administrator or Workspace Membership declarations. Package
work carries baseline Package version references. Configuration and execution work need only the
canonical target and operation facts. Non-provisioning work carries no stale creation payload.

List is bounded and paginated. Watch starts after an explicit delivery sequence, may replay work,
and has a finite maximum lifetime. A pending step remains discoverable until a valid acknowledgement
commits. A retry changes only blocked steps back to pending under the same operation and generation
and emits a new delivery sequence.

Lifecycle collection and watch cursors are likewise non-negative; `0` means no lifecycle delivery
has yet committed. Each delivered work item and step revision remains positive.

`ListLifecycleSteps.page_size` uses 50 when zero and admits one to 100 when
present. A page token is opaque, owner-bound, snapshot-bound, and finite-lived.
Malformed requests are `INVALID_ARGUMENT`; an absent, expired, wrong-owner, or
superseded token is `FAILED_PRECONDITION`.

`WatchLifecycleSteps` starts strictly after its non-negative cursor. A cursor
beyond the current delivery revision is `INVALID_ARGUMENT`. The stream writes
one bounded event at a time, observes transport backpressure, and ends at its
configured finite lifetime, caller cancellation, or deadline. It never
materializes an unbounded delivery set.

Direct lifecycle operations use the common authentication and dependency
statuses plus these operation outcomes:

| Operation | Outcome | Status |
| --- | --- | --- |
| GetLifecycle | target absent, parent mismatch, or invocation fence | `NOT_FOUND` |
| ListLifecycleSteps | expired or mismatched page token | `FAILED_PRECONDITION` |
| WatchLifecycleSteps | future or malformed cursor | `INVALID_ARGUMENT` |
| AcknowledgeLifecycleStep | target or assigned step absent | `NOT_FOUND` |
| AcknowledgeLifecycleStep | stale operation/generation or non-pending step | `FAILED_PRECONDITION` |
| AcknowledgeLifecycleStep | idempotency key reused for another result | `ALREADY_EXISTS` |
| AcknowledgeLifecycleStep | expected step revision differs | `ABORTED` |

## Audit delivery contract

Every accepted Tenant or Workspace mutation, including a lifecycle
acknowledgement, commits exactly one canonical audit intent in the same
transaction as its domain change. An exact idempotent replay returns the
original result and creates no second intent. A rejected or rolled-back
mutation creates none.

Each intent contains a random immutable source-event ID, the mutation's
database-wide source sequence, idempotency key, operation, occurred time,
original operator subject, optional immediate lifecycle-owner caller, exact
Tenant partition, typed Tenant or Workspace target, resulting resource
revision, successful outcome, and the request trace and span IDs. It contains
no request document, display name, address, initial administrator, Membership,
Package declaration, blocked reason, credential, or provider detail.

After commit, one bounded background dispatcher claims due intents in source
sequence order and calls `auditd.RecordAuditBatch` through one pooled channel
using `tenantd`'s bound workload credential. The dispatcher never calls
`auditd` while a resource transaction is open. A successful acceptance removes
the local intent. If the process fails after remote acceptance but before local
removal, the same source-event ID and canonical body are retried and `auditd`
returns the original acceptance.

Claims use finite leases so another replica can recover work after process
failure. Transient dependency failures release the claim with bounded capped
backoff. A conflicting replay or another permanent protocol rejection blocks
the intent and fails readiness rather than discarding or rewriting evidence.
Each mutable outbox row has a positive long revision. Claim, release, and
permanent-block transitions advance that revision and use it as the optimistic
concurrency precondition; delivery-attempt count is not a concurrency token.
The pending and claimed backlog has a fixed finite capacity; at capacity,
readiness fails and a new mutation returns unavailable without committing.
Shutdown does not invent delivery success: undelivered rows remain durable for
the next process.

## Direct operations

| Operation | Purpose |
| --- | --- |
| ResolveTenant | Resolve one immutable ID or admitted external address with a revision and finite cache expiry |
| ResolveWorkspace | Resolve one Workspace address inside an exact Tenant with a revision and finite cache expiry |
| GetLifecycle | Return current lifecycle and generation for authorization or reconciliation |
| ListLifecycleSteps | Page through currently assigned owner work after restart or resynchronization |
| WatchLifecycleSteps | Follow owner-assigned lifecycle work from an explicit delivery sequence |
| AcknowledgeLifecycleStep | Record one authenticated owner result for the current lifecycle generation |

External address resolution is always two explicit operations: first the Tenant root, then the
Workspace segment when the route contains the fixed Workspace boundary. Neither operation exposes
or duplicates an administrative record. A caller must resolve again after the supplied expiry.

Administrative CRUD and lifecycle changes use the aggregated resources.

## Callers and dependencies

| Caller | Operation | Purpose |
| --- | --- | --- |
| `authd`, `edged` | ResolveTenant, ResolveWorkspace | Resolve the external address hierarchy |
| `identityd`, `policyd`, `pkgd`, `configd`, `execd`, `egressd`, `auditd` | GetLifecycle | Fence an exact owner reference by current lifecycle |
| `identityd`, `configd`, `execd`, `pkgd` | ListLifecycleSteps, WatchLifecycleSteps, AcknowledgeLifecycleStep | Reconcile only work assigned to that authenticated owner |

`tenantd` has no child-owner client and no child-service endpoint configuration. Child owners
converge through the durable work contract. `tenantd` advances lifecycle only from a committed,
authenticated acknowledgement. Its only outbound domain delivery is idempotent audit-outbox
delivery to `auditd`, which never occurs inside a resource transaction.

## Verification

Canonical evidence covers:

- create, update, bounded list/watch, suspend, resume, retry, and irreversible deletion for Tenant
  and Workspace resources;
- permanent address allocation, collision, retirement, tombstones, and immutable Workspace parent;
- every provisioning step, restart between steps, duplicate acknowledgement, blocked step, stale
  generation, revision conflict, owner isolation, replay, retry, and delayed owner reconciliation;
- direct lookup and lifecycle operations across every lifecycle and visibility fence;
- bounded list continuation, mutation expiry, watch replay, stream lifetime, backpressure, and
  terminal tombstones;
- authentication, authorization, invocation fencing, schema incompatibility, cancellation,
  deadline, telemetry, transactional audit-outbox behavior, authenticated delivery, exact replay,
  retry after dependency outage and process restart, lease recovery, permanent-rejection
  readiness failure, and finite-capacity admission; and
- zero cross-Tenant visibility through reads, lists, watches, errors, caches, or acknowledgements.

## Invariants

- A Workspace has exactly one immutable parent Tenant.
- An admitted Tenant address permanently belongs to exactly one Tenant and is never reassigned,
  including after retirement or Tenant deletion.
- An admitted Workspace address permanently belongs to exactly one Workspace in its Tenant and is
  never reassigned, including after retirement or Workspace deletion.
- Each Tenant and Workspace has exactly one permanent external address binding.
- A Workspace address binding's Tenant is always the bound Workspace's parent Tenant; a binding that
  names a Workspace in a different Tenant is rejected at write time and never resolves.
- A binding's owner is immutable; no operation repoints or reactivates a retired binding.
- Active sibling address roots are non-overlapping under the routing grammar. Tenant-to-Workspace
  nesting occurs only through an explicit fixed structural boundary, so one request has one exact
  hierarchical resolution.
- Address-resolution cache hints are finite and never transfer address authority to a caller.
- Address grammar keeps user-controlled segments structurally separate from fixed route segments.
- Suspension is reversible and blocks new child activity.
- Lifecycle work is durable, owner-specific, at least once, and cannot be redirected by request
  data.
- Deletion is irreversible, cannot complete while an owner reports live child state, and leaves a
  terminal owner tombstone plus permanent address reservations.
- `tenantd` owns no User, Package, Placement, application, Kubernetes, or business-domain record.
- No service infers Tenant or Workspace truth from Kubernetes namespaces.

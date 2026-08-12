---
title: configd
description: Versioned configuration, encrypted secret custody, and exact consumer projections.
weight: 60
---

`configd` is the durable authority for scoped non-secret configuration,
encrypted secret custody, and projection of both data classes. It alone owns
projection; its sole wire contract is `services/configd/api/proto/v1/configd.proto`.

**Wire reference:** [configd gRPC API](../apis/configd/)

## Contract

Configd owns identities, immutable versions, current pointers/revisions, and
opaque projections, but not Placements, consumers, Packages, schemas, or workloads.

The contract has exactly five unary RPCs:

| RPC | Admitted caller | Necessity |
| --- | --- | --- |
| `PublishConfiguration` | Operator; scoped capability caller; configured provisioner | Create an identity and first non-secret version, or append one version |
| `ResolveConfiguration` | Operator; scoped capability caller | Return one exact non-secret version for management |
| `PublishSecret` | Operator; scoped capability caller; configured provisioner | Create a secret identity and encrypted first version, or append one version |
| `GetSecretMetadata` | Operator; scoped capability caller | Recover current secret version and revision without reading material |
| `ApplyProjection` | `SERVICE/svc_execd` | Ensure one exact configuration or secret version for its bound consumer |

## Authd provider projection

Authd has no Configd RPC. Configd supplies Authd's provider configuration
through its existing narrow Kubernetes projection realization: one read-only
non-secret manifest and one disjoint secret file, both purpose-bound to the
Authd workload. Authd resolves them once at startup and a changed generation
replaces the process. This creates no Configd method, watch, reload, fallback,
provider catalog, or combined secret/configuration read surface. Authd owns
the exact versioned JSON fields and consumer bounds in its [HTTP
contract](../authd/#deployed-dependencies); Configd materializes that
projection without interpreting OIDC.

Each projected provider carries the exact configuration and secret identity
and version references selected from Configd. Authd compares those non-secret
references with Identityd's current provider registration before using the
material. Configd remains unaware of providers and performs no Identityd call.

Operators manage every scope. An exact product-backend ServiceAccount may use
its admitted RPC only at Tenant, Workspace, or User scope under invocation and
policy. Execd may call only `ApplyProjection`. No generic key/value, list,
delete, binding mutation, secret read, watch, stream, preview, provider catalog,
worker, discovery, HTTP mirror, or Kubernetes-object API exists.

## Binding and content

Every identity and projection has one immutable `ConsumerBinding`:

```text
Placement ID
scope = global | Tenant(Tenant ID) | Workspace(Tenant ID, Workspace ID)
      | User(Tenant ID, account principal ID)
consumer ID
purpose
```

This is the closed Placement scope shared with Execd and Pkgd. Global has no
anchor; Workspace always includes its Tenant; User includes its Tenant and one
`user:` or `service:` account, never `agent:`. There are no optional scope
fields. Execd owns Placement and consumer facts. Purpose is an equality token,
not a provider selector; changing any binding part requires another identity.

IDs are 1 through 64 lower-case ASCII characters, start alphanumeric, and
otherwise contain only alphanumeric characters, `_`, or `-`; account
principals use Identityd's canonical form. Purpose is 1 through 64 lower-snake
characters matching `[a-z][a-z0-9]*(?:_[a-z0-9]+)*`. Version IDs are globally
unique within their data class. Projection IDs use the exact deterministic
[shared convention](../contracts/#deterministic-realization-convention) and
remain opaque.

Configuration content is 1 through 65,536 bytes of UTF-8 JSON without a BOM:
top-level object, maximum depth 32, and no duplicate member names. Exact bytes,
typed SHA-256 digest, and length are retained; schema validation is external.
Secret material is 1 through 65,536 arbitrary bytes, is never parsed, and has
no read response. The gRPC send and receive limit is 73,728 bytes.

Raw protobuf, JSON, content, plaintext, ciphertext, nonce, and tag exist only
in bounded Service/Db leases validated before Domain is called. Domain sees
typed metadata and purpose-named references exposing no bytes. Purpose-specific
Db operations consume/return leases; reusable plaintext buffers are cleared.

## Versions and projection

Publication carries one new version ID and optional `expected_revision`; every present request revision is 1 through 9,223,372,036,854,775,807, otherwise `INVALID_ARGUMENT`:

```text
absent           create an absent identity at revision 1
present positive append at exactly that existing revision
present zero     INVALID_ARGUMENT
```

Absent against an existing identity is `ALREADY_EXISTS`; present against an
absent identity is `NOT_FOUND`; mismatch is `ABORTED`. Publication atomically
stores the immutable version, selects it as current, and advances revision.

The version ID is the publication replay identity. Reuse with identical parent,
binding, expected revision, claim-selector pair presence/values, and exact
content succeeds without another mutation or audit fact; any difference is
`ALREADY_EXISTS`. Secret comparison stays inside the custody lease. This check
precedes current identity/revision checks. There is no generic idempotency key.

`ResolveConfiguration` requires exact identity, version, and binding and
returns current identity metadata, immutable version metadata, and exact bytes.
Execd is not admitted. `GetSecretMetadata` requires exact identity and binding
and returns current identity/version metadata only, never material, length,
digest, ciphertext, nonce, tag, or key ID.

`ApplyProjection` carries the binding and one closed target:

```text
Configuration(configuration ID, configuration-version ID)
Secret(secret ID, secret-version ID)
```

Each exact data-kind and binding owns one projection under the shared
convention. Kind, binding, ID, and first target identity are immutable. First
application creates revision 1; selecting another version advances revision.
Configuration may select any retained exact version. Secret may select only its
current version; replay never restores superseded material. Each exact target
may enter once; rollback requires a new version. Configd serializes Apply with
publication.

The target version ID is the Apply replay identity. Reapplying the selected
version is a semantic no-op; missing or drifted native state is repaired
synchronously without changing projection revision. Reapplying a superseded
target is `FAILED_PRECONDITION`, never a rollback. Execd is the sole writer, so
Apply needs neither a caller idempotency key nor expected revision.

The response contains only projection ID, target, binding, positive revision,
and timestamps. Execd verifies its deterministic ID and derives realization
only under the shared convention. It receives no content, native coordinate,
or path and invents no `binding_id`. No projection lookup API exists.

## Admission and errors

Operators present an end-to-end certificate chaining to the installation
Kubernetes client CA and an exact subject in Configd's per-RPC allowlist.
Operator calls carry no invocation.

A capability call requires its exact product-backend ServiceAccount, unchanged
valid invocation JWT, target fence, and `policyd.CheckAccess` allow. Global has
no capability path. Tenant/User require the invocation Tenant and no narrower
Workspace; User also requires account principal equal validated `sub` (the
attached account, not `act.sub`, for a virtual Actor). Workspace requires that
Tenant and any invocation Workspace. These checks precede Policyd; invisible
standing or mismatch is `NOT_FOUND`.

Configd gets invocation keys through
`identityd.GetInvocationVerificationKeys`, derives operation/path from
validated binding and resource IDs, and calls Policyd as
`SERVICE/svc_configd` without a transaction. Callers cannot supply operation,
path, Actor, account, Role, grant, or capability.

Provisioner admission is separate: operator/capability calls must omit optional
`dependency_claim_id` and `dependency_claim_revision`; the exact configured
controller must provide both. Mixed presence or zero is `INVALID_ARGUMENT`;
different or non-positive current claim revision is `FAILED_PRECONDITION`.
Static configuration authenticates only that ServiceAccount and provisioner,
never claims. Provisioner publication is non-Global; a Global provisioner
request is `PERMISSION_DENIED` before claim lookup or mutation. Configd
exact-GETs the claim, requires Execd ownership and request revision equal its
current positive `spec.claimRevision`, then verifies the admitted provisioner
and request Placement/consumer against the stored Placement/Workload ID.
Purpose, output kind, identity/version IDs, and expected revision use ordinary
Configd validation; dependency type/options and claim status are not read. The
selector pair grants no authority; Configd owns no claim table, registration,
list, or watch and holds no transaction across the GET.
The claim group, resource, fields, Placement Namespace, Workload
ServiceAccount, and owner annotations are the exact shared
[deterministic realization contract](../contracts/#deterministic-realization-convention).

| RPC | Policyd operation | Path after scoped prefix |
| --- | --- | --- |
| `PublishConfiguration` | `configurations.publish` | `/placements/<placement_id>/consumers/<consumer_id>/purposes/<purpose>/configurations/<configuration_id>` |
| `ResolveConfiguration` | `configurations.read` | `/placements/<placement_id>/consumers/<consumer_id>/purposes/<purpose>/configurations/<configuration_id>` |
| `PublishSecret` | `secrets.publish` | `/placements/<placement_id>/consumers/<consumer_id>/purposes/<purpose>/secrets/<secret_id>` |
| `GetSecretMetadata` | `secrets.read_metadata` | `/placements/<placement_id>/consumers/<consumer_id>/purposes/<purpose>/secrets/<secret_id>` |

The prefix is exactly `/tenants/<tenant_id>`,
`/tenants/<tenant_id>/workspaces/<workspace_id>`, or
`/tenants/<tenant_id>/accounts/<account_principal_id>`. All operations are
owned by `SERVICE/svc_configd`. Provisioner publication and
`ApplyProjection` carry no invocation and call neither Identityd nor Policyd;
the latter admits only `SERVICE/svc_execd`.

| Status | Exact meaning |
| --- | --- |
| `INVALID_ARGUMENT` | A field, union, ID, purpose, revision, claim-selector pair, or JSON value is malformed |
| `NOT_FOUND` | An exact visible identity, version, binding, fence, claim, or required update target is absent |
| `ALREADY_EXISTS` | A create target, version-ID reuse, projection hash, or native ownership collides |
| `FAILED_PRECONDITION` | A secret target is not current, projection parent differs or target was superseded, revision is exhausted, or claim revision/binding facts conflict |
| `ABORTED` | A present publication revision does not match |
| `RESOURCE_EXHAUSTED` | A content or transport bound is exceeded |
| `UNAUTHENTICATED` | Required operator, workload, or invocation identity is invalid |
| `PERMISSION_DENIED` | Caller is not admitted, does not match the claim provisioner, or policy denies |
| `UNAVAILABLE` | Persistence, keys, identity, policy, Kubernetes, or obligatory audit cannot complete |
| `CANCELLED` / `DEADLINE_EXCEEDED` | The call did not complete |

Raw storage, cryptographic, Kubernetes, content, credential, policy, and stack
diagnostics never cross the boundary.

## Custody and realization

The sole database contains purpose-specific identities and versions, optional
claim ID/revision pairs for replay equality, projections unique by kind/binding
and derived ID, and immutable applied outcomes. It contains no plaintext
secret, generic property/idempotency/claim table, Kubernetes cache, audit
outbox, or queue. No network call occurs in a transaction.

Secret versions use AES-256-GCM with fresh 96-bit nonce, 128-bit tag, and
length-prefixed additional authenticated data covering contract generation,
key ID, secret/version IDs, and complete binding. No plaintext digest is
persisted.

The additional authenticated data uses the shared four-byte big-endian
`field(s)` encoding and this exact sequence:

```text
ASCII("ctlflow.configuration.v1.SecretEnvelope") || 0x00
|| field(key_id)
|| field(secret_id)
|| field(secret_version_id)
|| field(placement_id)
|| scope_tag || scope_fields
|| field(consumer_id)
|| field(purpose)
```

The scope tags and fields are the exact values used by the deterministic
projection convention. This sequence is the contract generation; changing it
requires a new explicit envelope generation rather than fallback decryption.

`CTLFLOW_CONFIGD_ENCRYPTION_KEY_RING_PATH` is a validated absolute path to a
read-only process-private UTF-8 JSON file, at most 4,096 bytes:

```json
{"active_key_id":"<canonical-id>","keys":[{"key_id":"<canonical-id>","key_base64":"<32-byte-padded-base64>"}]}
```

It has strict fields, 1 through 8 unique keys, exactly one active key, and
canonical padded RFC 4648 base64. New versions use the active key; retained
keys decrypt old versions. Key material is never an environment, command-line,
API, log, telemetry, or audit value. There is no key API or file watch.
Readiness requires the exact migration ledger, a valid ring covering every
stored key ID, valid caller identities, and valid local Kubernetes, Identityd,
Policyd, and Auditd client trust; live remote availability is operation-scoped.

Configd applies the shared convention inside its Kubernetes adapter. It
derives and exact-GETs the Execd-owned Placement Namespace and Workload
ServiceAccount, verifies their exact owner-contract annotations against the
binding, and creates neither. It may get, create, or server-side apply only the
convention-named ConfigMap or `Opaque` Secret with its sole `content` payload
entry, exact Configd ownership annotations, and the exact Workload
ServiceAccount owner reference defined by the shared convention. It cannot
adopt an ownership collision, list, watch, delete, write another kind, or
accept native names, paths, environment mappings, or webhooks. An absent
projection object is created with create-only semantics. After every ownership
field has been proved exact, Configd may force-apply only its owned payload and
exact ownership shape with the observed Kubernetes resource version to repair
drift. A create race or stale apply cannot adopt or rewrite a replacement
object. Execd derives the name from the returned ID and mounts `content`
read-only at the convention path only into that Workload; ServiceAccount
deletion garbage-collects it.

## Audit and telemetry

After each listed mutation and outside its transaction, Configd must directly
submit one typed Auditd fact:

| Mutation | Required safe fact |
| --- | --- |
| Configuration/secret publication | Data kind, identity/version IDs, binding, resulting identity revision, and optional provisioner claim ID/revision pair |
| Projection create/version change | `created` or `version_changed`, projection ID/kind/revision, target identity/version IDs, binding |

Each fact also has operation, trace identity, and one generated random 128-bit
`evt_<32 lower-hex>` source event ID. Replay identity is authenticated source
plus that `source_event_id`. Attribution is the operator, the invocation
Actor/account plus immediate product backend, the provisioner controller plus
dependency claim ID/revision, or immediate `SERVICE/svc_execd` for projection.
Global uses the global partition; other scopes use their Tenant partition. The
immutable version or applied outcome retains the event ID for direct replay,
not as an outbox. Content, digests, material/encryption metadata, and native
coordinates are forbidden. Reads, rejection, replay, and native no-op add no
fact. Drift repair is operational reconciliation and emits telemetry only.

Auditd admits `SERVICE/svc_configd` and owns these typed detail variants.
OpenTelemetry covers bounded RPC, Db, crypto, dependency, and Kubernetes
latency/outcomes without bodies, domain IDs, secret metadata, or native
coordinates.

Release evidence covers the five unary descriptors, closed unions/admission,
claim GET, version/revision custody, projection convention, audit, and telemetry.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  assertKubernetesStatus
} from "../support/assert-kubernetes-status.js";
import {
  createTenantdTestContext,
  type TenantdTestContext
} from "../support/create-tenantd-test-context.js";
import {
  createInvalidTenantBodies
} from "../support/create-invalid-tenant-bodies.js";
import {
  createMaximumTenantBody
} from "../support/create-maximum-tenant-body.js";
import {
  requestTenancyApi,
  type TenancyApiResponse
} from "../support/request-tenancy-api.js";
import {
  findSpansForTrace
} from "../support/telemetry/find-spans-for-trace.js";
import {
  waitForExport
} from "../support/telemetry/wait-for-export.js";

interface TenantDocument {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: {
    readonly name: string;
    readonly resourceVersion: string;
    readonly creationTimestamp: string;
  };
  readonly spec: {
    readonly displayName: string;
    readonly address: {
      readonly authority: string;
      readonly pathPrefix: string;
    };
    readonly initialAdministrator: {
      readonly displayName: string;
      readonly loginIdentifier: string;
      readonly identityLink?: {
        readonly providerId: string;
        readonly providerSubject: string;
      };
    };
    readonly baselinePackages: readonly {
      readonly packageId: string;
      readonly packageVersion: string;
    }[];
  };
  readonly status: {
    readonly lifecycle: string;
    readonly revision: number;
    readonly provisioningGeneration: number;
    readonly currentOperation?: {
      readonly id: string;
      readonly kind: string;
    };
    readonly conditions: readonly {
      readonly owner: string;
      readonly state: string;
    }[];
  };
}

interface TenantListDocument {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: {
    readonly resourceVersion: string;
    readonly continue?: string;
  };
  readonly items: readonly TenantDocument[];
}

let context: TenantdTestContext | undefined;

describe("Tenant administration", { concurrency: false }, () => {
before(async () => {
  context = await createTenantdTestContext({
    registerAggregatedApi: true,
    seedResolutionData: false
  });
});

after(async () => {
  await context?.stop();
  context = undefined;
});

test("Kubernetes discovery exposes the complete tenancy resource surface", async () => {
  const response = await api({
    method: "GET",
    path: basePath
  });

  assert.equal(response.statusCode, 200);
  const body = requireRecord(response.body);
  assert.equal(body["apiVersion"], "v1");
  assert.equal(body["kind"], "APIResourceList");
  assert.equal(body["groupVersion"], "tenancy.ctlflow.com/v1alpha1");
  assert.deepEqual(
    requireArray(body["resources"]).map(requireRecord),
    [
      resource("tenants", "tenant", "Tenant",
        "get", "list", "watch", "create", "update", "delete"),
      resource("tenants/suspend", "", "Tenant", "update"),
      resource("tenants/resume", "", "Tenant", "update"),
      resource("tenants/retry", "", "Tenant", "update"),
      resource("workspaces", "workspace", "Workspace",
        "get", "list", "watch", "create", "update", "delete"),
      resource("workspaces/suspend", "", "Workspace", "update"),
      resource("workspaces/resume", "", "Workspace", "update"),
      resource("workspaces/retry", "", "Workspace", "update")
    ]);
});

test("exports the HTTP operation and its database child span", async () => {
  const traceId = "99999999999999999999999999999999";
  const response = await api({
    method: "GET",
    path: `${basePath}/tenants?limit=1`,
    headers: {
      traceparent: `00-${traceId}-aaaaaaaaaaaaaaaa-01`
    }
  });
  assert.equal(response.statusCode, 200);

  await waitForExport(
    requireContext().collector.tracesPath,
    (value) => {
      const spans = findSpansForTrace(value, traceId);
      const server = spans.find(
        (span) => span.name === "tenantd.ListOrWatchTenants");
      const database = spans.find(
        (span) => span.name === "tenantd.db.list_tenant_resources");
      return server !== undefined
        && database !== undefined
        && typeof server.spanId === "string"
        && database.parentSpanId === server.spanId
        && server.attributes?.some(
          (attribute) =>
            attribute.key === "http.request.method"
            && attribute.value?.stringValue === "GET") === true;
    });
});

test("creates, reads, updates, and idempotently replays a Tenant", async () => {
  const createBody = createTenantBody(
    "Northwind",
    "northwind.example.com");
  const createdResponse = await api({
    method: "POST",
    path: `${basePath}/tenants`,
    headers: { "Idempotency-Key": "create-northwind" },
    body: createBody
  });
  assert.equal(
    createdResponse.statusCode,
    201,
    `${createdResponse.text}\n${serviceDiagnostics()}`);
  const created = requireTenant(createdResponse);
  assert.match(created.metadata.name, /^tnt_[a-f0-9]{32}$/u);
  assert.equal(created.metadata.resourceVersion, "1");
  assert.equal(created.spec.displayName, "Northwind");
  assert.equal(created.status.lifecycle, "provisioning");
  assert.equal(created.status.revision, 1);
  assert.equal(created.status.provisioningGeneration, 1);
  assert.equal(created.status.currentOperation?.kind, "provision");
  assert.deepEqual(
    created.status.conditions.map((condition) => condition.owner),
    ["identity", "configuration", "execution", "packages"]);

  const replayResponse = await api({
    method: "POST",
    path: `${basePath}/tenants`,
    headers: { "Idempotency-Key": "create-northwind" },
    body: createBody
  });
  assert.equal(replayResponse.statusCode, 201);
  assert.equal(
    requireTenant(replayResponse).metadata.name,
    created.metadata.name);

  const readResponse = await api({
    method: "GET",
    path: `${basePath}/tenants/${created.metadata.name}`
  });
  assert.equal(readResponse.statusCode, 200);
  assert.deepEqual(requireTenant(readResponse), created);

  const updateBody = {
    ...created,
    spec: {
      ...created.spec,
      displayName: "Northwind Holdings"
    },
    status: undefined
  };
  const updatedResponse = await api({
    method: "PUT",
    path: `${basePath}/tenants/${created.metadata.name}`,
    headers: { "Idempotency-Key": "update-northwind" },
    body: updateBody
  });
  assert.equal(
    updatedResponse.statusCode,
    200,
    `${updatedResponse.text}\n${serviceDiagnostics()}`);
  const updated = requireTenant(updatedResponse);
  assert.equal(updated.spec.displayName, "Northwind Holdings");
  assert.equal(updated.metadata.resourceVersion, "2");
  assert.equal(updated.status.revision, 2);

  const replayUpdateResponse = await api({
    method: "PUT",
    path: `${basePath}/tenants/${created.metadata.name}`,
    headers: { "Idempotency-Key": "update-northwind" },
    body: updateBody
  });
  assert.equal(replayUpdateResponse.statusCode, 200);
  assert.deepEqual(requireTenant(replayUpdateResponse), updated);
});

test("rejects conflicting replay, address reuse, stale update, and immutable edits", async () => {
  const first = await createTenant(
    "Contoso",
    "contoso.example.com",
    "create-contoso");

  const conflictingReplay = await api({
    method: "POST",
    path: `${basePath}/tenants`,
    headers: { "Idempotency-Key": "create-contoso" },
    body: createTenantBody("Changed", "changed.example.com")
  });
  assertStatus(conflictingReplay, 409, "AlreadyExists");

  const duplicateAddress = await api({
    method: "POST",
    path: `${basePath}/tenants`,
    headers: { "Idempotency-Key": "create-duplicate-address" },
    body: createTenantBody("Duplicate", "contoso.example.com")
  });
  assertStatus(duplicateAddress, 409, "AlreadyExists");

  const stale = await api({
    method: "PUT",
    path: `${basePath}/tenants/${first.metadata.name}`,
    headers: { "Idempotency-Key": "stale-contoso" },
    body: {
      ...first,
      metadata: {
        ...first.metadata,
        resourceVersion: "999"
      },
      status: undefined
    }
  });
  assertStatus(stale, 409, "Conflict");

  for (const [key, spec] of [
    [
      "address",
      {
        ...first.spec,
        address: {
          authority: "other.example.com",
          pathPrefix: "/"
        }
      }
    ],
    [
      "administrator",
      {
        ...first.spec,
        initialAdministrator: {
          ...first.spec.initialAdministrator,
          loginIdentifier: "other@example.com"
        }
      }
    ],
    [
      "packages",
      {
        ...first.spec,
        baselinePackages: [
          ...first.spec.baselinePackages,
          { packageId: "pkg_other", packageVersion: "1.0.0" }
        ]
      }
    ]
  ] as const) {
    const immutable = await api({
      method: "PUT",
      path: `${basePath}/tenants/${first.metadata.name}`,
      headers: { "Idempotency-Key": `immutable-contoso-${key}` },
      body: { ...first, spec, status: undefined }
    });
    assertStatus(immutable, 422, "Invalid");
  }
});

test("lists Tenants with stable bounded continuation", async () => {
  await createTenant("Aperture", "aperture.example.com", "create-aperture");
  await createTenant("Globex", "globex.example.com", "create-globex");
  await createTenant("Initech", "initech.example.com", "create-initech");

  const firstResponse = await api({
    method: "GET",
    path: `${basePath}/tenants?limit=2`
  });
  assert.equal(firstResponse.statusCode, 200);
  const first = requireTenantList(firstResponse);
  assert.equal(first.items.length, 2);
  assert.ok(first.metadata.continue);

  const secondResponse = await api({
    method: "GET",
    path: `${basePath}/tenants?limit=2&continue=${
      encodeURIComponent(first.metadata.continue)}`,
  });
  assert.equal(secondResponse.statusCode, 200);
  const second = requireTenantList(secondResponse);
  assert.equal(second.metadata.resourceVersion, first.metadata.resourceVersion);
  assert.ok(second.items.length > 0);
  assert.equal(
    new Set([
      ...first.items.map((item) => item.metadata.name),
      ...second.items.map((item) => item.metadata.name)
    ]).size,
    first.items.length + second.items.length);
});

test("returns Kubernetes Status for malformed and missing requests", async () => {
  const missingKey = await api({
    method: "POST",
    path: `${basePath}/tenants`,
    body: createTenantBody("No key", "no-key.example.com")
  });
  assertStatus(missingKey, 400, "Invalid");

  const unknown = await api({
    method: "GET",
    path: `${basePath}/tenants/tnt_missing`
  });
  assertStatus(unknown, 404, "NotFound");

  const malformed = await api({
    method: "POST",
    path: `${basePath}/tenants`,
    headers: { "Idempotency-Key": "malformed-body" },
    body: {
      ...createTenantBody("Malformed", "malformed.example.com"),
      unexpected: true
    }
  });
  assertStatus(malformed, 400, "Invalid");
});

test("admits every exact Tenant field and collection maximum", async () => {
  const response = await api({
    method: "POST",
    path: `${basePath}/tenants`,
    headers: { "Idempotency-Key": "k".repeat(128) },
    body: createMaximumTenantBody()
  });
  assert.equal(response.statusCode, 201, response.text);
});

test("rejects every Tenant field, count, and duplicate beyond its contract", async () => {
  const base = createTenantBody("Invalid", "invalid.example.com");
  for (const [index, body] of createInvalidTenantBodies().entries()) {
    const response = await api({
      method: "POST",
      path: `${basePath}/tenants`,
      headers: { "Idempotency-Key": `invalid-tenant-${String(index)}` },
      body
    });
    assertStatus(response, 400, "Invalid");
  }

  for (const key of ["", "x".repeat(129), "not valid"]) {
    const response = await api({
      method: "POST",
      path: `${basePath}/tenants`,
      headers: { "Idempotency-Key": key },
      body: base
    });
    assertStatus(response, 400, "Invalid");
  }
});

test("keeps discovery available and fails resources closed on schema mismatch", async () => {
  await requireContext().database.connection("knex_migrations_lock")
    .update({ is_locked: 1 });
  try {
    const discovery = await api({ method: "GET", path: basePath });
    assert.equal(discovery.statusCode, 200, discovery.text);
    const list = await api({
      method: "GET",
      path: `${basePath}/tenants`
    });
    assertStatus(list, 503, "ServiceUnavailable");
  } finally {
    await requireContext().database.connection("knex_migrations_lock")
      .update({ is_locked: 0 });
  }
});
});

const basePath = "/apis/tenancy.ctlflow.com/v1alpha1";

function createTenantBody(
  displayName: string,
  authority: string
): Record<string, unknown> {
  return {
    apiVersion: "tenancy.ctlflow.com/v1alpha1",
    kind: "Tenant",
    metadata: {},
    spec: {
      displayName,
      address: {
        authority,
        pathPrefix: "/"
      },
      initialAdministrator: {
        displayName: "Ada Lovelace",
        loginIdentifier: "ada@example.com",
        identityLink: {
          providerId: "provider_primary",
          providerSubject: "ada-1"
        }
      },
      baselinePackages: [
        {
          packageId: "pkg_chat",
          packageVersion: "1.0.0"
        }
      ]
    }
  };
}

async function createTenant(
  displayName: string,
  authority: string,
  idempotencyKey: string
): Promise<TenantDocument> {
  const response = await api({
    method: "POST",
    path: `${basePath}/tenants`,
    headers: { "Idempotency-Key": idempotencyKey },
    body: createTenantBody(displayName, authority)
  });
  assert.equal(
    response.statusCode,
    201,
    `${response.text}\n${serviceDiagnostics()}`);
  return requireTenant(response);
}

async function api(
  request: Parameters<typeof requestTenancyApi>[1]
): Promise<TenancyApiResponse> {
  const current = context;
  assert.ok(current);
  return await requestTenancyApi(current.kubernetesApi, request);
}

function serviceDiagnostics(): string {
  return context?.service.diagnostics() ?? "service unavailable";
}

function requireTenant(response: TenancyApiResponse): TenantDocument {
  const body = requireRecord(response.body);
  assert.equal(body["apiVersion"], "tenancy.ctlflow.com/v1alpha1");
  assert.equal(body["kind"], "Tenant");
  return body as unknown as TenantDocument;
}

function requireTenantList(
  response: TenancyApiResponse
): TenantListDocument {
  const body = requireRecord(response.body);
  assert.equal(body["apiVersion"], "tenancy.ctlflow.com/v1alpha1");
  assert.equal(body["kind"], "TenantList");
  return body as unknown as TenantListDocument;
}

function assertStatus(
  response: TenancyApiResponse,
  code: number,
  reason: string
): void {
  assertKubernetesStatus(response, code, reason);
}

function requireRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

function requireArray(value: unknown): readonly unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

function resource(
  name: string,
  singularName: string,
  kind: string,
  ...verbs: readonly string[]
): Record<string, unknown> {
  return {
    name,
    singularName,
    namespaced: false,
    kind,
    verbs
  };
}

function requireContext(): TenantdTestContext {
  assert.ok(context);
  return context;
}

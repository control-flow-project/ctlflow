import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  assertKubernetesStatus
} from "../support/assert-kubernetes-status.js";
import {
  completeLifecycleOperation,
  type LifecycleOperationReference
} from "../support/complete-lifecycle-operation.js";
import {
  createTenantdTestContext,
  type TenantdTestContext
} from "../support/create-tenantd-test-context.js";
import {
  createTestTenant
} from "../support/create-test-tenant.js";
import {
  getTestTenant
} from "../support/get-test-tenant.js";
import {
  putLifecycleAction
} from "../support/put-lifecycle-action.js";
import {
  readFirstTenancyWatchEvent
} from "../support/read-first-tenancy-watch-event.js";
import {
  requestTenancyApi,
  type TenancyApiResponse
} from "../support/request-tenancy-api.js";
import {
  requireTenantDocument
} from "../support/require-tenant-document.js";
import type { TenantDocument } from "../support/tenant-document.js";

interface TenantListDocument {
  readonly metadata: {
    readonly resourceVersion: string;
    readonly continue?: string;
  };
  readonly items: readonly TenantDocument[];
}

const basePath = "/apis/tenancy.ctlflow.com/v1alpha1";
let context: TenantdTestContext | undefined;

describe("Tenant watch", { concurrency: false }, () => {
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

  test("replays exact ADDED and MODIFIED resource events", async () => {
    const initial = await listTenants();
    assert.equal(initial.metadata.resourceVersion, "0");

    const created = await createTestTenant(
      requireContext(),
      "Tenant Watch",
      "tenant-watch.example.com",
      "create-tenant-watch");
    const added = await readFirstTenancyWatchEvent(
      requireContext().kubernetesApi,
      watchPath(initial.metadata.resourceVersion));
    assert.equal(added.type, "ADDED");
    assert.deepEqual(added.object, created);

    const updateResponse = await api({
      method: "PUT",
      path: `${basePath}/tenants/${created.metadata.name}`,
      headers: { "Idempotency-Key": "update-tenant-watch" },
      body: {
        ...created,
        spec: {
          ...created.spec,
          displayName: "Tenant Watch Updated"
        },
        status: undefined
      }
    });
    assert.equal(updateResponse.statusCode, 200, updateResponse.text);
    const updated = requireTenantDocument(updateResponse);
    const modified = await readFirstTenancyWatchEvent(
      requireContext().kubernetesApi,
      watchPath(created.metadata.resourceVersion));
    assert.equal(modified.type, "MODIFIED");
    assert.deepEqual(modified.object, updated);
  });

  test("emits the final deleted tombstone as MODIFIED", async () => {
    const created = await createTestTenant(
      requireContext(),
      "Tenant Watch Delete",
      "tenant-watch-delete.example.com",
      "create-tenant-watch-delete");
    await completeTenantOperation(created);
    const active = await getTestTenant(
      requireContext(),
      created.metadata.name);
    const deleteResponse = await putLifecycleAction(
      requireContext(),
      "tenants",
      active.metadata.name,
      "delete",
      active.metadata.resourceVersion,
      "delete-tenant-watch");
    assert.equal(deleteResponse.statusCode, 202, deleteResponse.text);
    await completeTenantOperation(requireTenantDocument(deleteResponse));
    const deleted = await getTestTenant(
      requireContext(),
      active.metadata.name);

    const beforeFinal = String(
      Number.parseInt(deleted.metadata.resourceVersion, 10) - 1);
    const event = await readFirstTenancyWatchEvent(
      requireContext().kubernetesApi,
      watchPath(beforeFinal));
    assert.equal(event.type, "MODIFIED");
    assert.deepEqual(event.object, deleted);
    assert.equal(
      (event.object as TenantDocument).status.lifecycle,
      "deleted");
  });

  test("expires a list continuation after a mutation", async () => {
    await createTestTenant(
      requireContext(),
      "Tenant Page One",
      "tenant-page-one.example.com",
      "create-tenant-page-one");
    await createTestTenant(
      requireContext(),
      "Tenant Page Two",
      "tenant-page-two.example.com",
      "create-tenant-page-two");
    const first = await listTenants(1);
    assert.ok(first.metadata.continue);

    await createTestTenant(
      requireContext(),
      "Tenant Page Mutation",
      "tenant-page-mutation.example.com",
      "create-tenant-page-mutation");
    const continuation = await api({
      method: "GET",
      path: `${basePath}/tenants?limit=1&continue=${
        encodeURIComponent(first.metadata.continue)}`
    });
    assertKubernetesStatus(continuation, 410, "Expired");
  });

  test("rejects every incompatible list and watch parameter shape", async () => {
    for (const path of [
      `${basePath}/tenants?watch=true`,
      `${basePath}/tenants?watch=true&resourceVersion=0&limit=1`,
      `${basePath}/tenants?watch=true&resourceVersion=0&continue=value`,
      `${basePath}/tenants?watch=true&resourceVersion=-1`,
      `${basePath}/tenants?watch=invalid&resourceVersion=0`,
      `${basePath}/tenants?watch=true&watch=true&resourceVersion=0`,
      `${basePath}/tenants?resourceVersion=0`,
      `${basePath}/tenants?limit=0`,
      `${basePath}/tenants?limit=101`,
      `${basePath}/tenants?limit=not-a-number`
    ]) {
      assertKubernetesStatus(
        await api({ method: "GET", path }),
        400,
        "Invalid");
    }

    const current = await listTenants();
    assertKubernetesStatus(
      await api({
        method: "GET",
        path: watchPath(String(
          Number.parseInt(current.metadata.resourceVersion, 10) + 1))
      }),
      400,
      "Invalid");
  });

  test("returns Expired for a compacted cursor", async () => {
    const current = await listTenants();
    const currentSequence = Number.parseInt(
      current.metadata.resourceVersion,
      10);
    assert.ok(currentSequence > 0);
    await requireContext().database.connection("resource_event_sequences")
      .where({ sequence_id: 1 })
      .update({ retained_from_sequence: currentSequence });
    try {
      const response = await api({
        method: "GET",
        path: watchPath("0")
      });
      assertKubernetesStatus(response, 410, "Expired");
    } finally {
      await requireContext().database.connection("resource_event_sequences")
        .where({ sequence_id: 1 })
        .update({ retained_from_sequence: 1 });
    }
  });

  test("an idle watch ends at the configured finite lifetime", async () => {
    const current = await listTenants();
    const startedAt = Date.now();
    const response = await api({
      method: "GET",
      path: watchPath(current.metadata.resourceVersion)
    });
    const duration = Date.now() - startedAt;
    assert.equal(response.statusCode, 200, response.text);
    assert.equal(response.text, "");
    assert.match(
      String(response.headers["content-type"]),
      /^application\/json;stream=watch/u);
    assert.ok(duration >= 900, `watch ended after ${String(duration)}ms`);
    assert.ok(duration < 2_500, `watch ended after ${String(duration)}ms`);
  });
});

async function listTenants(limit?: number): Promise<TenantListDocument> {
  const response = await api({
    method: "GET",
    path: `${basePath}/tenants${limit === undefined ? "" : `?limit=${limit}`}`
  });
  assert.equal(response.statusCode, 200, response.text);
  assert.equal(
    (response.body as { readonly kind?: unknown }).kind,
    "TenantList");
  return response.body as TenantListDocument;
}

async function completeTenantOperation(
  tenant: TenantDocument
): Promise<void> {
  await completeLifecycleOperation(requireContext(), tenantOperation(tenant));
}

function tenantOperation(
  tenant: TenantDocument
): LifecycleOperationReference {
  const operationId = tenant.status.currentOperation?.id;
  assert.ok(operationId);
  return {
    target: { tenant: { tenantId: tenant.metadata.name } },
    operationId,
    provisioningGeneration: tenant.status.provisioningGeneration
  };
}

function watchPath(resourceVersion: string): string {
  return `${basePath}/tenants?watch=true&resourceVersion=${
    encodeURIComponent(resourceVersion)}`;
}

async function api(
  options: Parameters<typeof requestTenancyApi>[1]
): Promise<TenancyApiResponse> {
  return requestTenancyApi(requireContext().kubernetesApi, options);
}

function requireContext(): TenantdTestContext {
  assert.ok(context);
  return context;
}

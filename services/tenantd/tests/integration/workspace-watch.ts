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
  createTestWorkspace
} from "../support/create-test-workspace.js";
import {
  getTestWorkspace
} from "../support/get-test-workspace.js";
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
  requireWorkspaceDocument
} from "../support/require-workspace-document.js";
import type { TenantDocument } from "../support/tenant-document.js";
import type {
  WorkspaceDocument
} from "../support/workspace-document.js";

interface WorkspaceListDocument {
  readonly metadata: {
    readonly resourceVersion: string;
    readonly continue?: string;
  };
  readonly items: readonly WorkspaceDocument[];
}

const basePath = "/apis/tenancy.ctlflow.com/v1alpha1";
let context: TenantdTestContext | undefined;
let tenantId = "";

describe("Workspace watch", { concurrency: false }, () => {
  before(async () => {
    context = await createTenantdTestContext({
      registerAggregatedApi: true,
      seedResolutionData: false
    });
    const tenant = await createTestTenant(
      requireContext(),
      "Workspace Watch Tenant",
      "workspace-watch.example.com",
      "create-workspace-watch-tenant");
    await completeTenantOperation(tenant);
    tenantId = tenant.metadata.name;
  });

  after(async () => {
    await context?.stop();
    context = undefined;
    tenantId = "";
  });

  test("replays exact ADDED and MODIFIED resource events", async () => {
    const initial = await listWorkspaces();
    const created = await createTestWorkspace(
      requireContext(),
      tenantId,
      "Workspace Watch",
      "watch",
      "create-workspace-watch");
    const added = await readFirstTenancyWatchEvent(
      requireContext().kubernetesApi,
      watchPath(initial.metadata.resourceVersion));
    assert.equal(added.type, "ADDED");
    assert.deepEqual(added.object, created);

    const updateResponse = await api({
      method: "PUT",
      path: `${basePath}/workspaces/${created.metadata.name}`,
      headers: { "Idempotency-Key": "update-workspace-watch" },
      body: {
        ...created,
        spec: {
          ...created.spec,
          displayName: "Workspace Watch Updated"
        },
        status: undefined
      }
    });
    assert.equal(updateResponse.statusCode, 200, updateResponse.text);
    const updated = requireWorkspaceDocument(updateResponse);
    const modified = await readFirstTenancyWatchEvent(
      requireContext().kubernetesApi,
      watchPath(created.metadata.resourceVersion));
    assert.equal(modified.type, "MODIFIED");
    assert.deepEqual(modified.object, updated);
  });

  test("emits the final deleted tombstone as MODIFIED", async () => {
    const created = await createTestWorkspace(
      requireContext(),
      tenantId,
      "Workspace Watch Delete",
      "watch-delete",
      "create-workspace-watch-delete");
    await completeWorkspaceOperation(created);
    const active = await getTestWorkspace(
      requireContext(),
      created.metadata.name);
    const deleteResponse = await putLifecycleAction(
      requireContext(),
      "workspaces",
      active.metadata.name,
      "delete",
      active.metadata.resourceVersion,
      "delete-workspace-watch");
    assert.equal(deleteResponse.statusCode, 202, deleteResponse.text);
    await completeWorkspaceOperation(
      requireWorkspaceDocument(deleteResponse));
    const deleted = await getTestWorkspace(
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
      (event.object as WorkspaceDocument).status.lifecycle,
      "deleted");
  });

  test("expires a list continuation after a mutation", async () => {
    await createTestWorkspace(
      requireContext(),
      tenantId,
      "Workspace Page One",
      "page-one",
      "create-workspace-page-one");
    await createTestWorkspace(
      requireContext(),
      tenantId,
      "Workspace Page Two",
      "page-two",
      "create-workspace-page-two");
    const first = await listWorkspaces(1);
    assert.ok(first.metadata.continue);

    await createTestWorkspace(
      requireContext(),
      tenantId,
      "Workspace Page Mutation",
      "page-mutation",
      "create-workspace-page-mutation");
    const continuation = await api({
      method: "GET",
      path: `${listPath()}&limit=1&continue=${
        encodeURIComponent(first.metadata.continue)}`
    });
    assertKubernetesStatus(continuation, 410, "Expired");
  });

  test("rejects every incompatible list and watch parameter shape", async () => {
    const selector = selectorQuery();
    for (const path of [
      `${basePath}/workspaces?watch=true&resourceVersion=0`,
      `${basePath}/workspaces?${selector}&watch=true`,
      `${basePath}/workspaces?${selector}&watch=true&resourceVersion=0&limit=1`,
      `${basePath}/workspaces?${selector}&watch=true&resourceVersion=0&continue=value`,
      `${basePath}/workspaces?${selector}&watch=true&resourceVersion=-1`,
      `${basePath}/workspaces?${selector}&watch=invalid&resourceVersion=0`,
      `${basePath}/workspaces?${selector}&resourceVersion=0`,
      `${basePath}/workspaces?${selector}&limit=0`,
      `${basePath}/workspaces?${selector}&limit=101`,
      `${basePath}/workspaces?${selector}&limit=not-a-number`
    ]) {
      assertKubernetesStatus(
        await api({ method: "GET", path }),
        400,
        "Invalid");
    }

    const current = await listWorkspaces();
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
    const current = await listWorkspaces();
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
    const current = await listWorkspaces();
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

async function listWorkspaces(
  limit?: number
): Promise<WorkspaceListDocument> {
  const response = await api({
    method: "GET",
    path: `${listPath()}${limit === undefined ? "" : `&limit=${limit}`}`
  });
  assert.equal(response.statusCode, 200, response.text);
  assert.equal(
    (response.body as { readonly kind?: unknown }).kind,
    "WorkspaceList");
  return response.body as WorkspaceListDocument;
}

async function completeTenantOperation(
  tenant: TenantDocument
): Promise<void> {
  await completeLifecycleOperation(requireContext(), tenantOperation(tenant));
}

async function completeWorkspaceOperation(
  workspace: WorkspaceDocument
): Promise<void> {
  await completeLifecycleOperation(
    requireContext(),
    workspaceOperation(workspace));
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

function workspaceOperation(
  workspace: WorkspaceDocument
): LifecycleOperationReference {
  const operationId = workspace.status.currentOperation?.id;
  assert.ok(operationId);
  return {
    target: {
      workspace: {
        tenantId: workspace.spec.tenantId,
        workspaceId: workspace.metadata.name
      }
    },
    operationId,
    provisioningGeneration: workspace.status.provisioningGeneration
  };
}

function listPath(): string {
  return `${basePath}/workspaces?${selectorQuery()}`;
}

function watchPath(resourceVersion: string): string {
  return `${listPath()}&watch=true&resourceVersion=${
    encodeURIComponent(resourceVersion)}`;
}

function selectorQuery(): string {
  return `fieldSelector=${
    encodeURIComponent(`spec.tenantId=${tenantId}`)}`;
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

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { LifecycleState } from "../generated/v1/tenantd.js";
import {
  assertKubernetesStatus
} from "../support/assert-kubernetes-status.js";
import {
  createInvalidWorkspaceBodies
} from "../support/create-invalid-workspace-bodies.js";
import {
  createMaximumWorkspaceBody
} from "../support/create-maximum-workspace-body.js";
import {
  createTenantdTestContext,
  type TenantdTestContext
} from "../support/create-tenantd-test-context.js";
import {
  createWorkspaceBody
} from "../support/create-workspace-body.js";
import { insertTenant } from "../support/insert-tenant.js";
import {
  requestTenancyApi,
  type TenancyApiResponse
} from "../support/request-tenancy-api.js";

interface WorkspaceDocument {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: {
    readonly name: string;
    readonly resourceVersion: string;
    readonly creationTimestamp: string;
  };
  readonly spec: {
    readonly tenantId: string;
    readonly displayName: string;
    readonly workspaceAddress: string;
    readonly initialMemberships: readonly {
      readonly userId: string;
      readonly standing: string;
    }[];
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
  };
}

interface WorkspaceListDocument {
  readonly metadata: {
    readonly resourceVersion: string;
    readonly continue?: string;
  };
  readonly items: readonly WorkspaceDocument[];
}

const basePath = "/apis/tenancy.ctlflow.com/v1alpha1";
const primaryTenantId = "tenant_workspace_primary";
const secondaryTenantId = "tenant_workspace_secondary";
const suspendedTenantId = "tenant_workspace_suspended";
let context: TenantdTestContext | undefined;

describe("Workspace administration", { concurrency: false }, () => {
before(async () => {
  context = await createTenantdTestContext({
    registerAggregatedApi: true,
    seedResolutionData: false
  });
  for (const [id, lifecycle] of [
    [primaryTenantId, LifecycleState.LIFECYCLE_STATE_ACTIVE],
    [secondaryTenantId, LifecycleState.LIFECYCLE_STATE_ACTIVE],
    [suspendedTenantId, LifecycleState.LIFECYCLE_STATE_SUSPENDED]
  ] as const) {
    await insertTenant(requireContext().database.connection, {
      id,
      lifecycle
    });
  }
});

after(async () => {
  await context?.stop();
  context = undefined;
});

test("creates, reads, updates, and idempotently replays a Workspace", async () => {
  const body = createWorkspaceBody(
    primaryTenantId,
    "Workspace Alpha",
    "alpha");
  const createdResponse = await api({
    method: "POST",
    path: `${basePath}/workspaces`,
    headers: { "Idempotency-Key": "create-workspace-alpha" },
    body
  });
  assert.equal(createdResponse.statusCode, 201, createdResponse.text);
  const created = requireWorkspace(createdResponse);
  assert.match(created.metadata.name, /^wsp_[a-f0-9]{32}$/u);
  assert.equal(created.metadata.resourceVersion, "1");
  assert.equal(created.spec.tenantId, primaryTenantId);
  assert.equal(created.spec.workspaceAddress, "alpha");
  assert.equal(created.status.lifecycle, "provisioning");
  assert.equal(created.status.currentOperation?.kind, "provision");

  const replay = await api({
    method: "POST",
    path: `${basePath}/workspaces`,
    headers: { "Idempotency-Key": "create-workspace-alpha" },
    body
  });
  assert.equal(replay.statusCode, 201);
  assert.equal(
    requireWorkspace(replay).metadata.name,
    created.metadata.name);

  const read = await api({
    method: "GET",
    path: `${basePath}/workspaces/${created.metadata.name}`
  });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(requireWorkspace(read), created);

  const updateBody = {
    ...created,
    spec: {
      ...created.spec,
      displayName: "Workspace Alpha Updated"
    },
    status: undefined
  };
  const updatedResponse = await api({
    method: "PUT",
    path: `${basePath}/workspaces/${created.metadata.name}`,
    headers: { "Idempotency-Key": "update-workspace-alpha" },
    body: updateBody
  });
  assert.equal(updatedResponse.statusCode, 200, updatedResponse.text);
  const updated = requireWorkspace(updatedResponse);
  assert.equal(updated.spec.displayName, "Workspace Alpha Updated");
  assert.equal(updated.metadata.resourceVersion, "2");
  assert.equal(updated.status.revision, 2);

  const replayUpdate = await api({
    method: "PUT",
    path: `${basePath}/workspaces/${created.metadata.name}`,
    headers: { "Idempotency-Key": "update-workspace-alpha" },
    body: updateBody
  });
  assert.equal(replayUpdate.statusCode, 200);
  assert.deepEqual(requireWorkspace(replayUpdate), updated);
});

test("enforces parent-scoped addresses, replay, revision, and immutability", async () => {
  const first = await createWorkspace(
    primaryTenantId,
    "Workspace Beta",
    "beta",
    "create-workspace-beta");

  const conflictingReplay = await api({
    method: "POST",
    path: `${basePath}/workspaces`,
    headers: { "Idempotency-Key": "create-workspace-beta" },
    body: createWorkspaceBody(primaryTenantId, "Changed", "changed")
  });
  assertStatus(conflictingReplay, 409, "AlreadyExists");

  const duplicateAddress = await api({
    method: "POST",
    path: `${basePath}/workspaces`,
    headers: { "Idempotency-Key": "duplicate-workspace-beta" },
    body: createWorkspaceBody(primaryTenantId, "Duplicate", "beta")
  });
  assertStatus(duplicateAddress, 409, "AlreadyExists");

  const sameAddressInAnotherTenant = await api({
    method: "POST",
    path: `${basePath}/workspaces`,
    headers: { "Idempotency-Key": "secondary-workspace-beta" },
    body: createWorkspaceBody(secondaryTenantId, "Secondary Beta", "beta")
  });
  assert.equal(sameAddressInAnotherTenant.statusCode, 201);

  const stale = await api({
    method: "PUT",
    path: `${basePath}/workspaces/${first.metadata.name}`,
    headers: { "Idempotency-Key": "stale-workspace-beta" },
    body: {
      ...first,
      metadata: { ...first.metadata, resourceVersion: "999" },
      status: undefined
    }
  });
  assertStatus(stale, 409, "Conflict");

  for (const [key, spec] of [
    ["parent", { ...first.spec, tenantId: secondaryTenantId }],
    ["address", { ...first.spec, workspaceAddress: "new-beta" }],
    [
      "memberships",
      {
        ...first.spec,
        initialMemberships: [
          ...first.spec.initialMemberships,
          { userId: "usr_extra", standing: "member" }
        ]
      }
    ],
    [
      "packages",
      {
        ...first.spec,
        baselinePackages: [
          ...first.spec.baselinePackages,
          { packageId: "pkg_extra", packageVersion: "1.0.0" }
        ]
      }
    ]
  ] as const) {
    const immutable = await api({
      method: "PUT",
      path: `${basePath}/workspaces/${first.metadata.name}`,
      headers: { "Idempotency-Key": `immutable-workspace-${key}` },
      body: { ...first, spec, status: undefined }
    });
    assertStatus(immutable, 422, "Invalid");
  }
});

test("lists one Tenant's Workspaces with stable bounded continuation", async () => {
  for (const [name, address] of [
    ["Workspace Gamma", "gamma"],
    ["Workspace Delta", "delta"],
    ["Workspace Epsilon", "epsilon"]
  ] as const) {
    await createWorkspace(
      primaryTenantId,
      name,
      address,
      `create-${address}`);
  }

  const selector =
    `fieldSelector=${encodeURIComponent(`spec.tenantId=${primaryTenantId}`)}`;
  const firstResponse = await api({
    method: "GET",
    path: `${basePath}/workspaces?${selector}&limit=2`
  });
  assert.equal(firstResponse.statusCode, 200, firstResponse.text);
  const first = requireWorkspaceList(firstResponse);
  assert.equal(first.items.length, 2);
  assert.ok(first.metadata.continue);
  assert.ok(
    first.items.every((item) => item.spec.tenantId === primaryTenantId));

  const secondResponse = await api({
    method: "GET",
    path:
      `${basePath}/workspaces?${selector}&limit=2&continue=`
      + encodeURIComponent(first.metadata.continue)
  });
  assert.equal(secondResponse.statusCode, 200, secondResponse.text);
  const second = requireWorkspaceList(secondResponse);
  assert.equal(second.metadata.resourceVersion, first.metadata.resourceVersion);
  assert.ok(second.items.length > 0);

  const changedSelector = await api({
    method: "GET",
    path:
      `${basePath}/workspaces?fieldSelector=`
      + encodeURIComponent(`spec.tenantId=${secondaryTenantId}`)
      + `&limit=2&continue=${encodeURIComponent(first.metadata.continue)}`
  });
  assertStatus(changedSelector, 410, "Expired");
});

test("rejects missing, inactive, malformed, and unselected parents", async () => {
  const missingParent = await api({
    method: "POST",
    path: `${basePath}/workspaces`,
    headers: { "Idempotency-Key": "missing-parent" },
    body: createWorkspaceBody("tenant_missing", "Missing", "missing")
  });
  assertStatus(missingParent, 404, "NotFound");

  const inactiveParent = await api({
    method: "POST",
    path: `${basePath}/workspaces`,
    headers: { "Idempotency-Key": "inactive-parent" },
    body: createWorkspaceBody(
      suspendedTenantId,
      "Suspended",
      "suspended")
  });
  assertStatus(inactiveParent, 422, "Invalid");

  const missingSelector = await api({
    method: "GET",
    path: `${basePath}/workspaces`
  });
  assertStatus(missingSelector, 400, "Invalid");

  const malformed = await api({
    method: "POST",
    path: `${basePath}/workspaces`,
    headers: { "Idempotency-Key": "malformed-workspace" },
    body: {
      ...createWorkspaceBody(
        primaryTenantId,
        "Malformed",
        "malformed"),
      unexpected: true
    }
  });
  assertStatus(malformed, 400, "Invalid");

  const unknown = await api({
    method: "GET",
    path: `${basePath}/workspaces/wsp_missing`
  });
  assertStatus(unknown, 404, "NotFound");
});

test("admits every exact Workspace field and collection maximum", async () => {
  const response = await api({
    method: "POST",
    path: `${basePath}/workspaces`,
    headers: { "Idempotency-Key": "k".repeat(128) },
    body: createMaximumWorkspaceBody(primaryTenantId)
  });
  assert.equal(response.statusCode, 201, response.text);
});

test("rejects every Workspace field, count, and duplicate beyond its contract", async () => {
  const base = createWorkspaceBody(
    primaryTenantId,
    "Invalid",
    "invalid-bounds");
  for (const [index, body] of createInvalidWorkspaceBodies(
    primaryTenantId).entries()) {
    const response = await api({
      method: "POST",
      path: `${basePath}/workspaces`,
      headers: {
        "Idempotency-Key": `invalid-workspace-${String(index)}`
      },
      body
    });
    assertStatus(response, 400, "Invalid");
  }

  for (const key of ["", "x".repeat(129), "not valid"]) {
    const response = await api({
      method: "POST",
      path: `${basePath}/workspaces`,
      headers: { "Idempotency-Key": key },
      body: base
    });
    assertStatus(response, 400, "Invalid");
  }
});

test("fails Workspace resources closed on schema mismatch", async () => {
  await requireContext().database.connection("knex_migrations_lock")
    .update({ is_locked: 1 });
  try {
    const list = await api({
      method: "GET",
      path:
        `${basePath}/workspaces?fieldSelector=`
        + encodeURIComponent(`spec.tenantId=${primaryTenantId}`)
    });
    assertStatus(list, 503, "ServiceUnavailable");
  } finally {
    await requireContext().database.connection("knex_migrations_lock")
      .update({ is_locked: 0 });
  }
});
});

async function createWorkspace(
  tenantId: string,
  displayName: string,
  workspaceAddress: string,
  idempotencyKey: string
): Promise<WorkspaceDocument> {
  const response = await api({
    method: "POST",
    path: `${basePath}/workspaces`,
    headers: { "Idempotency-Key": idempotencyKey },
    body: createWorkspaceBody(tenantId, displayName, workspaceAddress)
  });
  assert.equal(response.statusCode, 201, response.text);
  return requireWorkspace(response);
}

async function api(
  options: Parameters<typeof requestTenancyApi>[1]
): Promise<TenancyApiResponse> {
  return requestTenancyApi(requireContext().kubernetesApi, options);
}

function requireWorkspace(response: TenancyApiResponse): WorkspaceDocument {
  assert.equal(typeof response.body, "object");
  assert.notEqual(response.body, null);
  assert.equal((response.body as { kind?: unknown }).kind, "Workspace");
  return response.body as WorkspaceDocument;
}

function requireWorkspaceList(
  response: TenancyApiResponse
): WorkspaceListDocument {
  assert.equal(typeof response.body, "object");
  assert.notEqual(response.body, null);
  assert.equal((response.body as { kind?: unknown }).kind, "WorkspaceList");
  return response.body as WorkspaceListDocument;
}

function assertStatus(
  response: TenancyApiResponse,
  code: number,
  reason: string
): void {
  assertKubernetesStatus(response, code, reason);
}

function requireContext(): TenantdTestContext {
  assert.ok(context);
  return context;
}

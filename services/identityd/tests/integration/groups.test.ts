import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import type {
  ListPrincipalGroupsRequest,
  ListPrincipalGroupsResponse
} from "../generated/v1/identityd.js";
import {
  getIdentitydTestContext
} from "../suite/get-identityd-test-context.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("returns only direct groups at the exact target", async () => {
  const tenant = await list(
    {
      principalId: "user:alice",
      tenantId: "acme",
      pageSize: 50
    },
    directInvocation());
  assert.deepEqual(
    tenant.groupIds,
    ["tenant_admins", "tenant_readers"]);

  const workspace = await list(
    {
      principalId: "user:alice",
      tenantId: "acme",
      workspaceId: "atlas",
      pageSize: 50
    },
    directInvocation("user:alice", "acme", "atlas"));
  assert.deepEqual(
    workspace.groupIds,
    ["atlas_editors", "atlas_readers"]);
  assert.equal(workspace.nextAfterGroupId, undefined);
});

test("returns virtual principal groups independently", async () => {
  const groups = await list(
    {
      principalId: "agent:reviewer",
      tenantId: "acme",
      workspaceId: "atlas",
      pageSize: 50
    },
    virtualInvocation(
      "agent:reviewer",
      "user:alice",
      "atlas"));
  assert.deepEqual(groups.groupIds, ["atlas_reviewers"]);
});

test("a virtual invocation may expand its attached account", async () => {
  const groups = await list(
    {
      principalId: "user:alice",
      tenantId: "acme",
      workspaceId: "atlas",
      pageSize: 50
    },
    virtualInvocation(
      "agent:reviewer",
      "user:alice",
      "atlas"));
  assert.deepEqual(
    groups.groupIds,
    ["atlas_editors", "atlas_readers"]);
});

test("unrelated and mismatched attachment group requests are concealed", async () => {
  await assert.rejects(
    list(
      {
        principalId: "user:bob",
        tenantId: "acme",
        pageSize: 50
      },
      directInvocation()),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    list(
      {
        principalId: "user:bob",
        tenantId: "acme",
        pageSize: 50
      },
      virtualInvocation(
        "agent:reviewer",
        "user:bob")),
    matchGrpcStatus(status.NOT_FOUND));
});

test("group pages use bounded keyset pagination", async () => {
  const first = await list(
    {
      principalId: "user:alice",
      tenantId: "acme",
      workspaceId: "atlas",
      pageSize: 1
    },
    directInvocation("user:alice", "acme", "atlas"));
  assert.deepEqual(first.groupIds, ["atlas_editors"]);
  assert.equal(first.nextAfterGroupId, "atlas_editors");

  const second = await list(
    {
      principalId: "user:alice",
      tenantId: "acme",
      workspaceId: "atlas",
      pageSize: 1,
      afterGroupId: first.nextAfterGroupId
    },
    directInvocation("user:alice", "acme", "atlas"));
  assert.deepEqual(second.groupIds, ["atlas_readers"]);
  assert.equal(second.nextAfterGroupId, undefined);
});

test("zero page size selects the documented default", async () => {
  const response = await list(
    {
      principalId: "user:alice",
      tenantId: "acme",
      workspaceId: "atlas",
      pageSize: 0
    },
    directInvocation("user:alice", "acme", "atlas"));
  assert.deepEqual(
    response.groupIds,
    ["atlas_editors", "atlas_readers"]);
});

test("continuations are stateless across concurrent inserts", async () => {
  const context = getIdentitydTestContext();
  const first = await list(
    {
      principalId: "user:alice",
      tenantId: "acme",
      workspaceId: "atlas",
      pageSize: 1
    },
    directInvocation("user:alice", "acme", "atlas"));
  await context.database.connection("groups").insert({
    group_id: "atlas_middle",
    tenant_id: "acme",
    workspace_id: "atlas"
  });
  await context.database.connection(
    "account_group_memberships"
  ).insert({
    account_id: "user:alice",
    group_id: "atlas_middle"
  });
  try {
    const next = await list(
      {
        principalId: "user:alice",
        tenantId: "acme",
        workspaceId: "atlas",
        pageSize: 50,
        afterGroupId: first.nextAfterGroupId
      },
      directInvocation("user:alice", "acme", "atlas"));
    assert.deepEqual(
      next.groupIds,
      ["atlas_middle", "atlas_readers"]);
  } finally {
    await context.database.connection(
      "account_group_memberships"
    ).where({ group_id: "atlas_middle" }).delete();
    await context.database.connection("groups")
      .where({ group_id: "atlas_middle" })
      .delete();
  }
});

test("standing and fences are re-established for every page", async () => {
  const context = getIdentitydTestContext();
  await context.database.connection("workspace_memberships")
    .where({
      account_id: "user:alice",
      tenant_id: "acme",
      workspace_id: "atlas"
    })
    .delete();
  try {
    await assert.rejects(
      list(
        {
          principalId: "user:alice",
          tenantId: "acme",
          workspaceId: "atlas",
          pageSize: 1,
          afterGroupId: "atlas_editors"
        },
        directInvocation("user:alice", "acme", "atlas")),
      matchGrpcStatus(status.NOT_FOUND));
  } finally {
    await context.database.connection(
      "workspace_memberships"
    ).insert({
      account_id: "user:alice",
      tenant_id: "acme",
      workspace_id: "atlas",
      revision: 31
    });
  }

  await assert.rejects(
    list(
      {
        principalId: "agent:atlas",
        tenantId: "acme",
        workspaceId: "beta",
        pageSize: 50
      },
      virtualInvocation(
        "agent:atlas",
        "service:automation")),
    matchGrpcStatus(status.NOT_FOUND));
});

test("malformed pagination and selectors are invalid", async () => {
  for (const request of [
    {
      principalId: "user:alice",
      tenantId: "acme",
      pageSize: 101
    },
    {
      principalId: "user:alice",
      tenantId: "acme",
      pageSize: 50,
      afterGroupId: "Bad Group"
    },
    {
      principalId: "invalid",
      tenantId: "acme",
      pageSize: 50
    }
  ]) {
    await assert.rejects(
      list(request, directInvocation()),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  }
});

async function list(
  request: ListPrincipalGroupsRequest,
  invocation: string
): Promise<ListPrincipalGroupsResponse> {
  const context = getIdentitydTestContext();
  return await callUnary<ListPrincipalGroupsResponse>((done) =>
    context.client.listPrincipalGroups(
      request,
      workloadMetadata(
        context.policydWorkload.callerToken,
        invocation),
      done));
}

function directInvocation(
  subject = "user:alice",
  tenantId = "acme",
  workspaceId?: string
): string {
  return getIdentitydTestContext().invocation.sign({
    subject,
    tenantId,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    tokenId: "groups-direct"
  });
}

function virtualInvocation(
  actorSubject: string,
  subject: string,
  workspaceId?: string
): string {
  return getIdentitydTestContext().invocation.sign({
    subject,
    actorSubject,
    tenantId: "acme",
    ...(workspaceId === undefined ? {} : { workspaceId }),
    sessionId: null,
    runId: "groups-run",
    tokenId: "groups-virtual"
  });
}

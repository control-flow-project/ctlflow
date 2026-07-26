import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  status
} from "@grpc/grpc-js";
import type {
  PolicyGrant
} from "@ctlflow/policyd/testing/stub";
import type {
  Tenant
} from "../generated/v1/tenantd.js";
import {
  getTenantdTestContext
} from "../suite/get-tenantd-test-context.js";
import {
  configureCapabilityPolicy
} from "../support/authorization/configure-capability-policy.js";
import {
  createCapabilityMetadata
} from "../support/authorization/create-capability-metadata.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  createTenant
} from "../support/tenants/create-tenant.js";
import {
  createWorkspace
} from "../support/workspaces/create-workspace.js";
import {
  findSpansForTrace
} from "../support/telemetry/find-spans-for-trace.js";
import {
  waitForExport
} from "../support/telemetry/wait-for-export.js";

test("a current direct Group grant authorizes a human principal", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "capability_group_tenant",
    address: "capability-group-tenant",
    displayName: "Capability Group Tenant"
  });
  const path = `/tenants/${tenant.tenantId}`;
  const groups = Array.from(
    { length: 101 },
    (_value, index) =>
      `tenant_readers_${String(index).padStart(3, "0")}`);
  const policyBaseline =
    (await context.policyd.readRequests()).length;
  await configureCapabilityPolicy(context, {
    tenantId: tenant.tenantId,
    actorGroups: groups,
    grants: [
      grant(groups[100]!, "tenants.read", path)
    ]
  });

  const traceId = "1a1b1c1d1e1f20212223242526272829";
  const metadata = createCapabilityMetadata(context, {
    tenantId: tenant.tenantId,
    tokenId: "capability-group"
  });
  metadata.set(
    "traceparent",
    `00-${traceId}-2234567890abcdef-01`);
  const loaded = await getTenant(tenant.tenantId, metadata);
  assert.equal(loaded.tenantId, tenant.tenantId);
  await waitForExport(
    context.collector.tracesPath,
    (value) => findSpansForTrace(value, traceId)
      .filter((span) =>
        span.name === "identityd.ListPrincipalGroups")
      .length === 2);
  const policyRequest =
    (await context.policyd.readRequests())[policyBaseline];
  assert.notEqual(policyRequest, undefined);
  const receivedTraceparent =
    policyRequest?.receivedTraceparent ?? "";
  assert.match(
    receivedTraceparent,
    /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u);
  assert.equal(
    receivedTraceparent.slice(3, 35),
    traceId);
  assert.notEqual(
    receivedTraceparent,
    `00-${traceId}-2234567890abcdef-01`);
});

test("subtree grants match only at canonical path boundaries", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "capability_subtree_tenant",
    address: "capability-subtree-tenant",
    displayName: "Capability Subtree Tenant"
  });
  const workspace = await createWorkspace(context, {
    workspaceId: "capability_subtree_workspace",
    tenantId: tenant.tenantId,
    address: "capability-subtree-workspace",
    displayName: "Capability Subtree Workspace"
  });
  const metadata = createCapabilityMetadata(context, {
    tenantId: tenant.tenantId,
    workspaceId: workspace.workspaceId,
    tokenId: "capability-subtree"
  });
  await configureCapabilityPolicy(context, {
    tenantId: tenant.tenantId,
    workspaceId: workspace.workspaceId,
    grants: [
      grant(
        "user:alice",
        "workspaces.read",
        `/tenants/${tenant.tenantId}`,
        "subtree")
    ]
  });
  const loaded = await callUnary<import(
    "../generated/v1/tenantd.js"
  ).Workspace>((done) =>
    context.workloadClient.getWorkspace(
      { workspaceId: workspace.workspaceId },
      metadata,
      done));
  assert.equal(loaded.workspaceId, workspace.workspaceId);

  await configureCapabilityPolicy(context, {
    tenantId: tenant.tenantId,
    workspaceId: workspace.workspaceId,
    grants: [
      grant(
        "user:alice",
        "workspaces.read",
        "/tenants/capability_subtree",
        "subtree")
    ]
  });
  await assert.rejects(
    callUnary<import(
      "../generated/v1/tenantd.js"
    ).Workspace>((done) =>
      context.workloadClient.getWorkspace(
        { workspaceId: workspace.workspaceId },
        metadata,
        done)),
    matchGrpcStatus(status.PERMISSION_DENIED));
});

test("a virtual principal and attached account must both be authorized", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "capability_virtual_tenant",
    address: "capability-virtual-tenant",
    displayName: "Capability Virtual Tenant"
  });
  const path = `/tenants/${tenant.tenantId}`;
  const metadata = createCapabilityMetadata(context, {
    tenantId: tenant.tenantId,
    subject: "service:automation",
    sessionId: null,
    runId: "virtual-agent-run",
    actorSubject: "agent:reviewer",
    tokenId: "capability-virtual"
  });
  const common = {
    tenantId: tenant.tenantId,
    actorId: "agent:reviewer",
    subjectAccountId: "service:automation",
    principalKind: "virtual" as const,
    actorGroups: ["agent_readers"],
    accountGroups: ["automation_readers"]
  };

  await configureCapabilityPolicy(context, {
    ...common,
    grants: [
      grant("agent_readers", "tenants.read", path),
      grant("automation_readers", "tenants.read", path)
    ]
  });
  assert.equal(
    (await getTenant(tenant.tenantId, metadata)).tenantId,
    tenant.tenantId);

  for (const grants of [
    [grant("agent_readers", "tenants.read", path)],
    [grant("automation_readers", "tenants.read", path)]
  ]) {
    await configureCapabilityPolicy(context, {
      ...common,
      grants
    });
    await assert.rejects(
      getTenant(tenant.tenantId, metadata),
      matchGrpcStatus(status.PERMISSION_DENIED));
  }

  const completeGrants = [
    grant("agent_readers", "tenants.read", path),
    grant("automation_readers", "tenants.read", path)
  ];
  for (const state of [
    {
      principalEnabled: false,
      subjectAccountEnabled: true
    },
    {
      principalEnabled: true,
      subjectAccountEnabled: false
    }
  ]) {
    await configureCapabilityPolicy(context, {
      ...common,
      ...state,
      grants: completeGrants
    });
    await assert.rejects(
      getTenant(tenant.tenantId, metadata),
      matchGrpcStatus(status.PERMISSION_DENIED));
  }
});

test("virtual-principal mutations audit both identities", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "capability_virtual_audit_tenant",
    address: "capability-virtual-audit-tenant",
    displayName: "Capability Virtual Audit Tenant"
  });
  const path = `/tenants/${tenant.tenantId}`;
  await configureCapabilityPolicy(context, {
    tenantId: tenant.tenantId,
    actorId: "agent:renamer",
    subjectAccountId: "service:automation",
    principalKind: "virtual",
    grants: [
      grant(
        "agent:renamer",
        "tenants.update_display_name",
        path),
      grant(
        "service:automation",
        "tenants.update_display_name",
        path)
    ]
  });
  const auditBaseline =
    (await context.auditd.readTenancyEvents()).length;
  const updated = await callUnary<Tenant>((done) =>
    context.workloadClient.updateTenant(
      {
        tenantId: tenant.tenantId,
        expectedRevision: tenant.revision,
        displayName: "Renamed By Agent"
      },
      createCapabilityMetadata(context, {
        tenantId: tenant.tenantId,
        subject: "service:automation",
        sessionId: null,
        runId: "renamer-run",
        actorSubject: "agent:renamer",
        tokenId: "capability-virtual-audit"
      }),
      done));
  assert.equal(updated.displayName, "Renamed By Agent");

  const audit = (await context.auditd.readTenancyEvents())
    .slice(auditBaseline);
  assert.equal(audit.length, 1);
  assert.equal(
    audit[0]?.actorPrincipalId,
    "agent:renamer");
  assert.equal(
    audit[0]?.attachedAccountPrincipalId,
    "service:automation");
  assert.equal(
    audit[0]?.immediateCaller,
    context.capabilityWorkload.callerSubject);
});

function grant(
  subjectId: string,
  operation: string,
  resourcePath: string,
  match: PolicyGrant["match"] = "exact"
): PolicyGrant {
  return {
    subjectId,
    operation,
    resourcePath,
    match
  };
}

async function getTenant(
  tenantId: string,
  metadata: import("@grpc/grpc-js").Metadata
): Promise<Tenant> {
  const context = getTenantdTestContext();
  return await callUnary<Tenant>((done) =>
    context.workloadClient.getTenant(
      { tenantId },
      metadata,
      done));
}

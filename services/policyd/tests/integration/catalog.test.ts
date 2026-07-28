import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  status
} from "@grpc/grpc-js";
import {
  AccessDecision
} from "../generated/v1/policyd.js";
import {
  getPolicydTestContext
} from "../suite/get-policyd-test-context.js";
import {
  callCheckAccess
} from "../support/call-check-access.js";
import {
  catalogCases,
  type PolicyOwner
} from "../support/catalog-case.js";
import {
  directGrant
} from "../support/direct-grant.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  principalFact
} from "../support/principal-fact.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("allows every catalog operation from its exact owner and target", async () => {
  const context = getPolicydTestContext();
  await context.reset();
  await context.policyd.setPrincipalFacts([
    principalFact(),
    principalFact({
      workspaceId: "atlas",
      membershipRevision: 2
    })
  ]);
  await context.policyd.replacePolicy({
    roles: [],
    grants: catalogCases.map((entry) =>
      directGrant(
        entry.operation,
        entry.resourcePath,
        {
          target: {
            tenantId: entry.tenantId,
            ...(entry.workspaceId === undefined
              ? {}
              : { workspaceId: entry.workspaceId })
          }
        }))
  });

  for (const entry of catalogCases) {
    const response = await callCheckAccess(
      {
        operation: entry.operation,
        resourcePath: entry.resourcePath,
        tenantId: entry.tenantId,
        workspaceId: entry.workspaceId
      },
      { owner: entry.owner });
    assert.equal(
      response.decision,
      AccessDecision.ACCESS_DECISION_ALLOW,
      entry.operation);
  }
});

test("rejects each catalog partition from another authenticated owner", async () => {
  const owners: Readonly<Record<PolicyOwner, PolicyOwner>> = {
    tenantd: "pkgd",
    pkgd: "configd",
    configd: "execd",
    execd: "tenantd"
  };
  for (const entry of [
    catalogCases[0]!,
    catalogCases[8]!,
    catalogCases[11]!,
    catalogCases[15]!
  ]) {
    await assert.rejects(
      callCheckAccess(
        {
          operation: entry.operation,
          resourcePath: entry.resourcePath,
          tenantId: entry.tenantId,
          workspaceId: entry.workspaceId
        },
        { owner: owners[entry.owner] }),
      matchGrpcStatus(status.PERMISSION_DENIED));
  }
});

test("rejects an unadmitted workload and unknown operation", async () => {
  const context = getPolicydTestContext();
  const invocation = context.invocation.sign({ tenantId: "acme" });
  await assert.rejects(
    callCheckAccess(
      {
        operation: "tenants.read",
        resourcePath: "/tenants/acme",
        tenantId: "acme"
      },
      {
        metadata: workloadMetadata(
          context.workloads.unadmitted.callerToken,
          invocation)
      }),
    matchGrpcStatus(status.PERMISSION_DENIED));
  await assert.rejects(
    callCheckAccess({
      operation: "widgets.read",
      resourcePath: "/tenants/acme/widgets/item",
      tenantId: "acme"
    }),
    matchGrpcStatus(status.PERMISSION_DENIED));
});

test("distinguishes malformed operations from invalid known targets", async () => {
  for (const operation of [
    "",
    "Tenants.read",
    "tenants.*",
    "tenants.read.extra"
  ]) {
    await assert.rejects(
      callCheckAccess({
        operation,
        resourcePath: "/tenants/acme",
        tenantId: "acme"
      }),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  }

  for (const request of [
    {
      operation: "tenants.read",
      resourcePath: "/tenants/other",
      tenantId: "acme"
    },
    {
      operation: "workspaces.create",
      resourcePath: "/tenants/acme/workspaces/atlas",
      tenantId: "acme"
    },
    {
      operation: "workspaces.suspend",
      resourcePath: "/tenants/acme/workspaces",
      tenantId: "acme",
      workspaceId: "atlas"
    },
    {
      operation: "apps.read",
      resourcePath: "/tenants/acme/users/alice/apps/chat",
      tenantId: "acme"
    },
    {
      operation: "placements.read",
      resourcePath: "/tenants/acme/placements/",
      tenantId: "acme"
    }
  ]) {
    await assert.rejects(
      callCheckAccess(request, {
        owner: ownerFor(request.operation)
      }),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  }
});

test("conceals invocation and account-scope fence mismatches", async () => {
  await assert.rejects(
    callCheckAccess(
      {
        operation: "apps.read",
        resourcePath: "/tenants/acme/workspaces/atlas/apps/chat",
        tenantId: "acme",
        workspaceId: "atlas"
      },
      {
        owner: "pkgd",
        invocation: {
          tenantId: "acme",
          workspaceId: "other"
        }
      }),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    callCheckAccess(
      {
        operation: "apps.read",
        resourcePath: "/tenants/acme/accounts/service:automation/apps/chat",
        tenantId: "acme"
      },
      {
        owner: "pkgd",
        invocation: {
          tenantId: "acme",
          subject: "user:alice"
        }
      }),
    matchGrpcStatus(status.NOT_FOUND));
});

function ownerFor(operation: string): PolicyOwner {
  if (operation.startsWith("apps.")) {
    return "pkgd";
  }
  if (operation.startsWith("configurations.")
      || operation.startsWith("secrets.")) {
    return "configd";
  }
  if (operation.startsWith("placements.")
      || operation.startsWith("workloads.")
      || operation.startsWith("runs.")) {
    return "execd";
  }
  return "tenantd";
}

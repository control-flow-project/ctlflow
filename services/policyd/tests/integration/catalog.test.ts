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
        `svc_${entry.owner}`,
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

test("routes a non-kernel workload to Execd and fails closed without it", async () => {
  const context = getPolicydTestContext();
  const invocation = context.invocation.sign({ tenantId: "acme" });
  // A workload outside the exact kernel set is a product workload. Its
  // authority lives in Execd's admission state; with Execd unavailable the
  // decision fails closed rather than guessing.
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
    matchGrpcStatus(status.UNAVAILABLE));
});

test("rejects an unknown operation from a kernel owner", async () => {
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

// Product operations are namespaced by the caller: Policyd classifies the
// authenticated workload before interpreting the token, and resolves product
// authority through Execd at decision time. This suite deploys no Execd, so
// the product branch is proven to route and fail closed here; the complete
// production flow is exercised in the Execd suite.
const productOperation = "messages.post";
const productResourcePath =
  "/tenants/acme/workspaces/atlas/apps/app_chat/topics/topic_1/messages";

test("fails closed for a product operation when Execd is unavailable", async () => {
  const context = getPolicydTestContext();
  await context.reset();
  await context.policyd.setPrincipalFacts([
    principalFact({ workspaceId: "atlas", membershipRevision: 2 })
  ]);
  await assert.rejects(
    callCheckAccess(
      {
        operation: productOperation,
        resourcePath: productResourcePath,
        tenantId: "acme",
        workspaceId: "atlas"
      },
      { owner: "product" }),
    matchGrpcStatus(status.UNAVAILABLE));
});

test("keeps a product workload out of the kernel branch", async () => {
  // Whatever token it names, a non-kernel caller is resolved through Execd:
  // classification precedes token interpretation, so a lexically kernel token
  // cannot cross into the kernel namespace. Without Execd it fails closed.
  await assert.rejects(
    callCheckAccess(
      {
        operation: "tenants.read",
        resourcePath: "/tenants/acme",
        tenantId: "acme"
      },
      { owner: "product" }),
    matchGrpcStatus(status.UNAVAILABLE));
});


test("rejects a product operation from a kernel owner", async () => {
  // An exact kernel caller enforces only its own catalog operations; a
  // package token is not among them, whatever its spelling.
  for (const owner of ["tenantd", "pkgd", "execd"] as const) {
    await assert.rejects(
      callCheckAccess(
        {
          operation: productOperation,
          resourcePath: productResourcePath,
          tenantId: "acme",
          workspaceId: "atlas"
        },
        { owner }),
      matchGrpcStatus(status.PERMISSION_DENIED),
      owner);
  }
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

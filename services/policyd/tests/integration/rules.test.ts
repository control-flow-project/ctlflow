import assert from "node:assert/strict";
import {
  test
} from "node:test";
import type {
  PolicyRole
} from "@ctlflow/policyd/testing/production";
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
  directGrant
} from "../support/direct-grant.js";
import {
  principalFact
} from "../support/principal-fact.js";

const request = {
  operation: "workspaces.read",
  resourcePath: "/tenants/acme/workspaces/atlas",
  tenantId: "acme",
  workspaceId: "atlas"
};

test("exact rules match only the exact canonical path", async () => {
  const context = await arrangeWorkspace();
  await context.policyd.replacePolicy({
    roles: [],
    grants: [directGrant(
      "workspaces.read",
      request.resourcePath,
      {
        target: {
          tenantId: "acme",
          workspaceId: "atlas"
        }
      })]
  });
  assert.equal(
    (await callCheckAccess(request)).decision,
    AccessDecision.ACCESS_DECISION_ALLOW);
  assert.equal(
    (await callCheckAccess({
      ...request,
      resourcePath: "/tenants/acme/workspaces/beta",
      workspaceId: "beta"
    }, {
      invocation: {
        tenantId: "acme",
        workspaceId: "beta"
      }
    })).decision,
    AccessDecision.ACCESS_DECISION_DENY);
});

test("subtree rules are delimiter bounded", async () => {
  const context = await arrangeWorkspace();
  await context.policyd.replacePolicy({
    roles: [],
    grants: [directGrant(
      "workspaces.read",
      "/tenants/acme/workspaces",
      {
        target: {
          tenantId: "acme",
          workspaceId: "atlas"
        },
        match: "subtree"
      })]
  });
  assert.equal(
    (await callCheckAccess({
      operation: "workspaces.read",
      resourcePath: "/tenants/acme/workspaces/atlas",
      tenantId: "acme",
      workspaceId: "atlas"
    })).decision,
    AccessDecision.ACCESS_DECISION_ALLOW);

  await context.policyd.replacePolicy({
    roles: [],
    grants: [directGrant(
      "workspaces.read",
      "/tenants/acme/workspaces/at",
      {
        target: {
          tenantId: "acme",
          workspaceId: "atlas"
        },
        match: "subtree"
      })]
  });
  assert.equal(
    (await callCheckAccess({
      operation: "workspaces.read",
      resourcePath: "/tenants/acme/workspaces/atlas",
      tenantId: "acme",
      workspaceId: "atlas"
    })).decision,
    AccessDecision.ACCESS_DECISION_DENY);
});

test("allows direct Group and Role-bound principal authority", async () => {
  const context = await arrangeWorkspace(["reviewers"]);
  const role: PolicyRole = {
    roleId: "workspace_reader",
    target: {
      tenantId: "acme",
      workspaceId: "atlas"
    },
    rules: [{
      operation: "workspaces.read",
      basePath: request.resourcePath,
      match: "exact"
    }],
    subjects: [{
      kind: "principal",
      id: "user:alice"
    }]
  };
  await context.policyd.replacePolicy({
    roles: [role],
    grants: []
  });
  assert.equal(
    (await callCheckAccess(request)).decision,
    AccessDecision.ACCESS_DECISION_ALLOW);

  await context.policyd.replacePolicy({
    roles: [],
    grants: [directGrant(
      "workspaces.read",
      request.resourcePath,
      {
        target: {
          tenantId: "acme",
          workspaceId: "atlas"
        },
        subject: {
          kind: "group",
          id: "reviewers"
        }
      })]
  });
  assert.equal(
    (await callCheckAccess(request)).decision,
    AccessDecision.ACCESS_DECISION_ALLOW);
});

test("allows Role-bound Group authority and isolates exact targets", async () => {
  const context = await arrangeWorkspace(["reviewers"]);
  await context.policyd.replacePolicy({
    roles: [{
      roleId: "group_reader",
      target: {
        tenantId: "acme",
        workspaceId: "atlas"
      },
      rules: [{
        operation: "workspaces.read",
        basePath: request.resourcePath,
        match: "exact"
      }],
      subjects: [{
        kind: "group",
        id: "reviewers"
      }]
    }],
    grants: []
  });
  assert.equal(
    (await callCheckAccess(request)).decision,
    AccessDecision.ACCESS_DECISION_ALLOW);
  assert.equal(
    (await callCheckAccess({
      operation: "workspaces.read",
      resourcePath: "/tenants/acme/workspaces",
      tenantId: "acme"
    })).decision,
    AccessDecision.ACCESS_DECISION_DENY);
});

test("returns deny when current identity has no matching allow", async () => {
  await arrangeWorkspace();
  assert.equal(
    (await callCheckAccess(request)).decision,
    AccessDecision.ACCESS_DECISION_DENY);
});

async function arrangeWorkspace(
  groups: readonly string[] = []
) {
  const context = getPolicydTestContext();
  await context.reset();
  await context.policyd.setPrincipalFacts([
    principalFact({
      workspaceId: "atlas",
      groupIds: groups
    }),
    principalFact({
      workspaceId: "beta",
      membershipRevision: 2
    })
  ]);
  return context;
}

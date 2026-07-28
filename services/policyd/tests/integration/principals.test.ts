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
  directGrant
} from "../support/direct-grant.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  principalFact
} from "../support/principal-fact.js";

const request = {
  operation: "apps.read",
  resourcePath: "/tenants/acme/apps/chat",
  tenantId: "acme"
};

test("allows current human and service Actors", async () => {
  const context = getPolicydTestContext();
  await context.reset();
  await context.policyd.setPrincipalFacts([
    principalFact(),
    principalFact({
      principalId: "service:automation",
      principalKind: "service",
      subjectAccountId: "service:automation"
    })
  ]);
  await context.policyd.replacePolicy({
    roles: [],
    grants: [
      directGrant("apps.read", request.resourcePath),
      directGrant("apps.read", request.resourcePath, {
        subject: {
          kind: "principal",
          id: "service:automation"
        }
      })
    ]
  });
  assert.equal(
    (await callCheckAccess(request, { owner: "pkgd" })).decision,
    AccessDecision.ACCESS_DECISION_ALLOW);
  assert.equal(
    (await callCheckAccess(request, {
      owner: "pkgd",
      invocation: {
        subject: "service:automation",
        sessionId: null,
        runId: "run_service"
      }
    })).decision,
    AccessDecision.ACCESS_DECISION_ALLOW);
});

test("requires virtual Actor and attached account authority", async () => {
  const context = getPolicydTestContext();
  await context.reset();
  await context.policyd.setPrincipalFacts([
    principalFact({
      principalId: "agent:reviewer",
      principalKind: "virtual",
      principalRevision: 2,
      subjectAccountId: "user:alice"
    })
  ]);
  const actor = directGrant("apps.read", request.resourcePath, {
    subject: {
      kind: "principal",
      id: "agent:reviewer"
    }
  });
  const account = directGrant("apps.read", request.resourcePath);
  const invocation = {
    subject: "user:alice",
    actorSubject: "agent:reviewer",
    sessionId: null,
    runId: "run_reviewer"
  };

  for (const grants of [[actor], [account]]) {
    await context.policyd.replacePolicy({ roles: [], grants });
    assert.equal(
      (await callCheckAccess(request, {
        owner: "pkgd",
        invocation
      })).decision,
      AccessDecision.ACCESS_DECISION_DENY);
  }
  await context.policyd.replacePolicy({
    roles: [],
    grants: [actor, account]
  });
  assert.equal(
    (await callCheckAccess(request, {
      owner: "pkgd",
      invocation
    })).decision,
    AccessDecision.ACCESS_DECISION_ALLOW);
});

test("denies disabled Actor or attached account", async () => {
  const context = getPolicydTestContext();
  await context.reset();
  await context.policyd.replacePolicy({
    roles: [],
    grants: [
      directGrant("apps.read", request.resourcePath),
      directGrant("apps.read", request.resourcePath, {
        subject: {
          kind: "principal",
          id: "agent:reviewer"
        }
      })
    ]
  });
  for (const facts of [
    principalFact({
      principalId: "user:alice",
      principalEnabled: false,
      subjectAccountEnabled: false
    }),
    principalFact({
      principalId: "agent:reviewer",
      principalKind: "virtual",
      principalEnabled: false,
      subjectAccountId: "user:alice"
    }),
    principalFact({
      principalId: "agent:reviewer",
      principalKind: "virtual",
      subjectAccountId: "user:alice",
      subjectAccountEnabled: false
    })
  ]) {
    await context.policyd.setPrincipalFacts([facts]);
    const virtual = facts.principalKind === "virtual";
    assert.equal(
      (await callCheckAccess(request, {
        owner: "pkgd",
        invocation: virtual
          ? {
            subject: "user:alice",
            actorSubject: "agent:reviewer",
            sessionId: null,
            runId: "run_reviewer"
          }
          : {}
      })).decision,
      AccessDecision.ACCESS_DECISION_DENY);
  }
});

test("conceals missing current standing", async () => {
  const context = getPolicydTestContext();
  await context.reset();
  await assert.rejects(
    callCheckAccess(request, { owner: "pkgd" }),
    matchGrpcStatus(status.NOT_FOUND));
});

test("consumes every Group page before deciding", async () => {
  const context = getPolicydTestContext();
  await context.reset();
  const groups = Array.from(
    { length: 205 },
    (_, index) => `group_${String(index).padStart(3, "0")}`);
  await context.policyd.setPrincipalFacts([
    principalFact({ groupIds: groups })
  ]);
  await context.policyd.replacePolicy({
    roles: [],
    grants: [directGrant("apps.read", request.resourcePath, {
      subject: {
        kind: "group",
        id: groups[204]!
      }
    })]
  });
  assert.equal(
    (await callCheckAccess(request, { owner: "pkgd" })).decision,
    AccessDecision.ACCESS_DECISION_ALLOW);
});

test("paginates virtual Actor and attached-account Groups separately", async () => {
  const context = getPolicydTestContext();
  await context.reset();
  const actorGroups = Array.from(
    { length: 101 },
    (_, index) => `actor_${String(index).padStart(3, "0")}`);
  const accountGroups = Array.from(
    { length: 101 },
    (_, index) => `account_${String(index).padStart(3, "0")}`);
  await context.policyd.setPrincipalFacts([
    principalFact({
      principalId: "agent:reviewer",
      principalKind: "virtual",
      subjectAccountId: "user:alice",
      groupIds: actorGroups
    }),
    principalFact({
      groupIds: accountGroups,
      membershipRevision: 2
    })
  ]);
  await context.policyd.replacePolicy({
    roles: [],
    grants: [
      directGrant("apps.read", request.resourcePath, {
        subject: {
          kind: "group",
          id: actorGroups[100]!
        }
      }),
      directGrant("apps.read", request.resourcePath, {
        subject: {
          kind: "group",
          id: accountGroups[100]!
        }
      })
    ]
  });
  assert.equal(
    (await callCheckAccess(request, {
      owner: "pkgd",
      invocation: {
        subject: "user:alice",
        actorSubject: "agent:reviewer",
        sessionId: null,
        runId: "run_reviewer"
      }
    })).decision,
    AccessDecision.ACCESS_DECISION_ALLOW);
});

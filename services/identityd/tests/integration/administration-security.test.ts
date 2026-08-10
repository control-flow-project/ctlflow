import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  Metadata,
  status
} from "@grpc/grpc-js";
import type {
  LoginProvider,
  ListLoginProvidersResponse,
  ListTenantMembersResponse,
  ListWorkspaceLoginProviderAdmissionsResponse
} from "../generated/v1/identityd.js";
import {
  getIdentitydTestContext
} from "../suite/get-identityd-test-context.js";
import {
  createAdministrationCalls
} from "../support/administration/create-administration-calls.js";
import {
  allowIdentityCapabilities
} from "../support/authorization/allow-identity-capabilities.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  identityAdminMetadata
} from "../support/identity-admin-metadata.js";
import {
  waitForPolicyReadiness
} from "../support/dependencies/wait-for-policy-readiness.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("administration requires invocation identity and capability", async () => {
  const context = getIdentitydTestContext();
  await context.policyd.replacePolicy({ roles: [], grants: [] });

  for (const call of createAdministrationCalls(
    workloadMetadata(context.adminWorkload.callerToken)
  )) {
    await assert.rejects(
      call.request(),
      matchGrpcStatus(status.UNAUTHENTICATED),
      call.name);
  }

  for (const call of createAdministrationCalls(
    identityAdminMetadata(context, "acme")
  )) {
    await assert.rejects(
      call.request(),
      matchGrpcStatus(status.PERMISSION_DENIED),
      call.name);
  }
});

test("administration authenticates before parsing request fields", async () => {
  const context = getIdentitydTestContext();
  const callers = [
    new Metadata(),
    workloadMetadata(context.adminWorkload.callerToken)
  ];

  for (const metadata of callers) {
    for (const call of createAdministrationCalls(
      metadata,
      "malformed_target",
      "INVALID"
    )) {
      await assert.rejects(
        call.request(),
        matchGrpcStatus(status.UNAUTHENTICATED),
        call.name);
    }
  }
});

test("Workspace invocation fences are applied before policy", async () => {
  const context = getIdentitydTestContext();
  await context.policyd.replacePolicy({ roles: [], grants: [] });
  const betaInvocation = identityAdminMetadata(
    context,
    "acme",
    "beta");

  for (const call of createAdministrationCalls(betaInvocation)) {
    await assert.rejects(
      call.request(),
      matchGrpcStatus(status.NOT_FOUND),
      call.name);
  }
});

test("administration fails closed when real Policyd is unavailable", async () => {
  const context = getIdentitydTestContext();
  await allowIdentityCapabilities(context, [{
    operation: "tenant_memberships.read",
    resourcePath: "/tenants/acme/members",
    tenantId: "acme"
  }]);
  await context.policyd.setAvailable(false);
  try {
    await assert.rejects(
      callUnary<ListTenantMembersResponse>((callback) =>
        context.client.listTenantMembers(
          { tenantId: "acme", pageSize: 50 },
          identityAdminMetadata(context, "acme"),
          callback)),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.policyd.setAvailable(true);
    await context.service.restart();
    await waitForPolicyReadiness(
      context.client,
      context.adminWorkload,
      context.invocation,
      true);
  }
});

test("Authd exact provider reads are autonomous and least-privileged",
  async () => {
    const context = getIdentitydTestContext();
    const authd = workloadMetadata(context.authdWorkload.callerToken);
    const provider = await callUnary<LoginProvider>((callback) =>
      context.client.getLoginProvider(
        { tenantId: "acme", providerId: "oidc" },
        authd,
        callback));
    assert.equal(provider.providerId, "oidc");
    const admissions = await callUnary<
      ListWorkspaceLoginProviderAdmissionsResponse
    >((callback) => context.client.listWorkspaceLoginProviderAdmissions(
      { tenantId: "acme", workspaceId: "atlas", pageSize: 50 },
      authd,
      callback));
    assert.deepEqual(
      admissions.admissions.map((admission) => admission.providerId),
      ["oidc"]);

    await assert.rejects(
      callUnary<ListLoginProvidersResponse>((callback) =>
        context.client.listLoginProviders(
          { tenantId: "acme", pageSize: 50 },
          authd,
          callback)),
      matchGrpcStatus(status.PERMISSION_DENIED));

    const withInvocation = workloadMetadata(
      context.authdWorkload.callerToken,
      context.invocation.sign({ tenantId: "acme" }));
    for (const request of [
      () => callUnary<LoginProvider>((callback) =>
        context.client.getLoginProvider(
          { tenantId: "acme", providerId: "oidc" },
          withInvocation,
          callback)),
      () => callUnary<ListWorkspaceLoginProviderAdmissionsResponse>(
        (callback) => context.client
          .listWorkspaceLoginProviderAdmissions(
            { tenantId: "acme", workspaceId: "atlas", pageSize: 50 },
            withInvocation,
            callback))
    ]) {
      await assert.rejects(
        request(),
        matchGrpcStatus(status.UNAUTHENTICATED));
    }
  });

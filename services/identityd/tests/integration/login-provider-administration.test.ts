import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  status
} from "@grpc/grpc-js";
import {
  LoginProviderState,
  type ListLoginProvidersResponse,
  type ListWorkspaceLoginProviderAdmissionsResponse,
  type LoginProvider,
  type SetWorkspaceLoginProviderAdmissionResponse
} from "../generated/v1/identityd.js";
import {
  getIdentitydTestContext
} from "../suite/get-identityd-test-context.js";
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
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("administers provider metadata, state, and Workspace admission", async () => {
  const context = getIdentitydTestContext();
  const providerId = "admin_oidc";
  const workspaceId = "provider_bootstrap";
  const providerPath = `/tenants/acme/login-providers/${providerId}`;
  const providerCollection = "/tenants/acme/login-providers";
  const admissionPath =
    `/tenants/acme/workspaces/${workspaceId}/login-providers/${providerId}`;
  const admissionCollection =
    `/tenants/acme/workspaces/${workspaceId}/login-providers`;
  await allowIdentityCapabilities(context, [
    tenantCapability("login_providers.create", providerPath),
    tenantCapability("login_providers.read", providerPath),
    tenantCapability("login_providers.read", providerCollection),
    tenantCapability("login_providers.update", providerPath),
    tenantCapability("login_providers.set_state", providerPath),
    tenantCapability(
      "workspace_login_provider_admissions.set",
      admissionPath),
    tenantCapability(
      "workspace_login_provider_admissions.read",
      admissionCollection)
  ]);
  const admin = identityAdminMetadata(context, "acme");
  const authd = workloadMetadata(context.authdWorkload.callerToken);
  const selector = { tenantId: "acme", providerId };
  const initial = {
    ...selector,
    displayName: "Admin OIDC",
    configurationId: "admin_oidc",
    configurationVersionId: "admin_oidc_1",
    secretId: "admin_oidc_secret",
    secretVersionId: "admin_oidc_secret_1"
  };

  const created = await callUnary<LoginProvider>((callback) =>
    context.client.createLoginProvider(initial, admin, callback));
  assert.equal(created.state, LoginProviderState.LOGIN_PROVIDER_STATE_ACTIVE);
  assert.equal(created.revision, 1n);
  assert.deepEqual(
    await callUnary<LoginProvider>((callback) =>
      context.client.getLoginProvider(selector, admin, callback)),
    created);
  assert.deepEqual(
    await callUnary<LoginProvider>((callback) =>
      context.client.getLoginProvider(selector, authd, callback)),
    created);

  const providers = await callUnary<ListLoginProvidersResponse>((callback) =>
    context.client.listLoginProviders(
      { tenantId: "acme", pageSize: 1 },
      admin,
      callback));
  assert.equal(providers.providers.length, 1);
  assert.notEqual(providers.nextAfterProviderId, undefined);

  const updated = await callUnary<LoginProvider>((callback) =>
    context.client.updateLoginProvider(
      {
        ...initial,
        expectedRevision: 1n,
        displayName: "Admin workforce",
        configurationVersionId: "admin_oidc_2",
        secretVersionId: "admin_oidc_secret_2"
      },
      admin,
      callback));
  assert.equal(updated.displayName, "Admin workforce");
  assert.equal(updated.revision, 2n);
  assert.deepEqual(
    await callUnary<LoginProvider>((callback) =>
      context.client.updateLoginProvider(
        {
          ...initial,
          expectedRevision: 2n,
          displayName: "Admin workforce",
          configurationVersionId: "admin_oidc_2",
          secretVersionId: "admin_oidc_secret_2"
        },
        admin,
        callback)),
    updated);
  await assert.rejects(
    callUnary<LoginProvider>((callback) =>
      context.client.updateLoginProvider(
        { ...initial, expectedRevision: 1n },
        admin,
        callback)),
    matchGrpcStatus(status.ABORTED));

  const disabled = await callUnary<LoginProvider>((callback) =>
    context.client.setLoginProviderState(
      {
        ...selector,
        expectedRevision: 2n,
        state: LoginProviderState.LOGIN_PROVIDER_STATE_DISABLED
      },
      admin,
      callback));
  assert.equal(disabled.state, LoginProviderState.LOGIN_PROVIDER_STATE_DISABLED);
  assert.equal(disabled.revision, 3n);
  assert.deepEqual(
    await callUnary<LoginProvider>((callback) =>
      context.client.setLoginProviderState(
        {
          ...selector,
          expectedRevision: 3n,
          state: LoginProviderState.LOGIN_PROVIDER_STATE_DISABLED
        },
        admin,
        callback)),
    disabled);
  await assert.rejects(
    callUnary<LoginProvider>((callback) =>
      context.client.setLoginProviderState(
        {
          ...selector,
          expectedRevision: 2n,
          state: LoginProviderState.LOGIN_PROVIDER_STATE_ACTIVE
        },
        admin,
        callback)),
    matchGrpcStatus(status.ABORTED));

  const admitted = await callUnary<SetWorkspaceLoginProviderAdmissionResponse>(
    (callback) =>
      context.client.setWorkspaceLoginProviderAdmission(
        {
          ...selector,
          workspaceId,
          admitted: true
        },
        admin,
        callback));
  assert.deepEqual(admitted.admission, {
    ...selector,
    workspaceId
  });
  const admissions =
    await callUnary<ListWorkspaceLoginProviderAdmissionsResponse>((callback) =>
      context.client.listWorkspaceLoginProviderAdmissions(
        { tenantId: "acme", workspaceId, pageSize: 100 },
        authd,
        callback));
  assert.equal(
    admissions.admissions.some((entry) => entry.providerId === providerId),
    true);

  const removed =
    await callUnary<SetWorkspaceLoginProviderAdmissionResponse>((callback) =>
      context.client.setWorkspaceLoginProviderAdmission(
        {
          ...selector,
          workspaceId,
          admitted: false
        },
        admin,
        callback));
  assert.equal(removed.admission, undefined);
  assert.equal(
    (await callUnary<ListWorkspaceLoginProviderAdmissionsResponse>(
      (callback) => context.client.listWorkspaceLoginProviderAdmissions(
        { tenantId: "acme", workspaceId, pageSize: 100 },
        authd,
        callback))).admissions.some((entry) =>
          entry.providerId === providerId),
    false);
  await callUnary<SetWorkspaceLoginProviderAdmissionResponse>((callback) =>
    context.client.setWorkspaceLoginProviderAdmission(
      {
        ...selector,
        workspaceId,
        admitted: false
      },
      admin,
      callback));
  await callUnary<SetWorkspaceLoginProviderAdmissionResponse>((callback) =>
    context.client.setWorkspaceLoginProviderAdmission(
      {
        ...selector,
        workspaceId,
        admitted: true
      },
      admin,
      callback));

  const active = await callUnary<LoginProvider>((callback) =>
    context.client.setLoginProviderState(
      {
        ...selector,
        expectedRevision: 3n,
        state: LoginProviderState.LOGIN_PROVIDER_STATE_ACTIVE
      },
      admin,
      callback));
  const deleted = await callUnary<LoginProvider>((callback) =>
    context.client.setLoginProviderState(
      {
        ...selector,
        expectedRevision: active.revision,
        state: LoginProviderState.LOGIN_PROVIDER_STATE_DELETED
      },
      admin,
      callback));
  assert.equal(deleted.state, LoginProviderState.LOGIN_PROVIDER_STATE_DELETED);

  await assert.rejects(
    callUnary<LoginProvider>((callback) =>
      context.client.setLoginProviderState(
        {
          ...selector,
          expectedRevision: deleted.revision,
          state: LoginProviderState.LOGIN_PROVIDER_STATE_ACTIVE
        },
        admin,
        callback)),
    matchGrpcStatus(status.FAILED_PRECONDITION));
  await assert.rejects(
    callUnary<LoginProvider>((callback) =>
      context.client.updateLoginProvider(
        {
          ...initial,
          expectedRevision: deleted.revision
        },
        admin,
        callback)),
    matchGrpcStatus(status.FAILED_PRECONDITION));

  await assert.rejects(
    callUnary<LoginProvider>((callback) =>
      context.client.getLoginProvider(selector, authd, callback)),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    callUnary<LoginProvider>((callback) =>
      context.client.createLoginProvider(initial, admin, callback)),
    matchGrpcStatus(status.ALREADY_EXISTS));
  const afterDeletion =
    await callUnary<ListWorkspaceLoginProviderAdmissionsResponse>((callback) =>
      context.client.listWorkspaceLoginProviderAdmissions(
        { tenantId: "acme", workspaceId, pageSize: 100 },
        authd,
        callback));
  assert.equal(
    afterDeletion.admissions.some((entry) => entry.providerId === providerId),
    false);
});

test("Workspace authority administers only its exact provider admission",
  async () => {
    const context = getIdentitydTestContext();
    const providerId = "oidc";
    const workspaceId = "atlas";
    const path =
      `/tenants/acme/workspaces/${workspaceId}/login-providers/${providerId}`;
    await allowIdentityCapabilities(context, [
      workspaceCapability(
        "workspace_login_provider_admissions.set",
        path,
        workspaceId)
    ]);
    const metadata = identityAdminMetadata(context, "acme", workspaceId);

    const removed =
      await callUnary<SetWorkspaceLoginProviderAdmissionResponse>((done) =>
        context.client.setWorkspaceLoginProviderAdmission(
          { tenantId: "acme", workspaceId, providerId, admitted: false },
          metadata,
          done));
    assert.equal(removed.admission, undefined);
    const restored =
      await callUnary<SetWorkspaceLoginProviderAdmissionResponse>((done) =>
        context.client.setWorkspaceLoginProviderAdmission(
          { tenantId: "acme", workspaceId, providerId, admitted: true },
          metadata,
          done));
    assert.deepEqual(restored.admission, {
      tenantId: "acme",
      workspaceId,
      providerId
    });
  });

test("non-canonical stored provider metadata fails unavailable", async () => {
  const context = getIdentitydTestContext();
  const authd = workloadMetadata(context.authdWorkload.callerToken);
  const original = await context.database.connection<{
    readonly display_name: string;
    readonly provider_id: string;
    readonly tenant_id: string;
  }>("login_providers")
    .select("display_name")
    .where({ tenant_id: "acme", provider_id: "oidc" })
    .first();
  assert.ok(original !== undefined);
  await context.database.connection("login_providers")
    .where({ tenant_id: "acme", provider_id: "oidc" })
    .update({ display_name: ` ${original.display_name}` });
  try {
    await assert.rejects(
      callUnary<LoginProvider>((callback) =>
        context.client.getLoginProvider(
          { tenantId: "acme", providerId: "oidc" },
          authd,
          callback)),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.database.connection("login_providers")
      .where({ tenant_id: "acme", provider_id: "oidc" })
      .update(original);
  }
});

test("provider metadata enforces its canonical wire bounds", async () => {
  const context = getIdentitydTestContext();
  const providerId = "bounded_oidc";
  const providerPath = `/tenants/acme/login-providers/${providerId}`;
  await allowIdentityCapabilities(context, [
    tenantCapability("login_providers.create", providerPath),
    tenantCapability("login_providers.update", providerPath)
  ]);
  const metadata = identityAdminMetadata(context, "acme");
  const valid = {
    tenantId: "acme",
    providerId,
    displayName: "Bounded OIDC",
    configurationId: "bounded_oidc",
    configurationVersionId: "bounded_oidc_1",
    secretId: "bounded_oidc_secret",
    secretVersionId: "bounded_oidc_secret_1"
  };
  const invalidFields = [
    "configurationId",
    "configurationVersionId",
    "secretId",
    "secretVersionId"
  ] as const;

  for (const field of invalidFields) {
    await assert.rejects(
      callUnary<LoginProvider>((callback) =>
        context.client.createLoginProvider(
          { ...valid, [field]: "x".repeat(65) },
          metadata,
          callback)),
      matchGrpcStatus(status.INVALID_ARGUMENT),
      field);
  }
  await assert.rejects(
    callUnary<LoginProvider>((callback) =>
      context.client.createLoginProvider(
        { ...valid, displayName: "x".repeat(129) },
        metadata,
        callback)),
    matchGrpcStatus(status.INVALID_ARGUMENT));

  const created = await callUnary<LoginProvider>((callback) =>
    context.client.createLoginProvider(valid, metadata, callback));
  for (const field of invalidFields) {
    await assert.rejects(
      callUnary<LoginProvider>((callback) =>
        context.client.updateLoginProvider(
          {
            ...valid,
            [field]: "x".repeat(65),
            expectedRevision: created.revision
          },
          metadata,
          callback)),
      matchGrpcStatus(status.INVALID_ARGUMENT),
      field);
  }
  await assert.rejects(
    callUnary<LoginProvider>((callback) =>
      context.client.updateLoginProvider(
        {
          ...valid,
          displayName: "x".repeat(129),
          expectedRevision: created.revision
        },
        metadata,
        callback)),
    matchGrpcStatus(status.INVALID_ARGUMENT));
});

function tenantCapability(operation: string, resourcePath: string) {
  return { operation, resourcePath, tenantId: "acme" };
}

function workspaceCapability(
  operation: string,
  resourcePath: string,
  workspaceId: string
) {
  return { operation, resourcePath, tenantId: "acme", workspaceId };
}

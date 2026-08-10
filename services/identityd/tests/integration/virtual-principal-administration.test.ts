import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  status
} from "@grpc/grpc-js";
import type {
  ListVirtualPrincipalsResponse,
  VirtualPrincipal
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

test("administers one immutable virtual principal fence", async () => {
  const context = getIdentitydTestContext();
  const principalId = "agent:admin_flow";
  const atlasRoot = "/tenants/acme/workspaces/atlas/virtual-principals";
  const betaRoot = "/tenants/acme/workspaces/beta/virtual-principals";
  await allowIdentityCapabilities(context, [
    capability("virtual_principals.create", `${atlasRoot}/${principalId}`, "atlas"),
    capability("virtual_principals.read", `${atlasRoot}/${principalId}`, "atlas"),
    capability("virtual_principals.read", atlasRoot, "atlas"),
    capability(
      "virtual_principals.set_enabled",
      `${atlasRoot}/${principalId}`,
      "atlas"),
    capability("virtual_principals.read", `${betaRoot}/${principalId}`, "beta"),
    capability("virtual_principals.create", `${betaRoot}/${principalId}`, "beta")
  ]);
  const metadata = identityAdminMetadata(context, "acme");
  const selector = {
    principalId,
    tenantId: "acme",
    workspaceId: "atlas"
  };

  const created = await callUnary<VirtualPrincipal>((callback) =>
    context.client.createVirtualPrincipal(
      { ...selector, subjectAccountId: "user:alice" },
      metadata,
      callback));
  assert.deepEqual(created, {
    ...selector,
    subjectAccountId: "user:alice",
    enabled: true,
    revision: 1n
  });
  assert.deepEqual(
    await callUnary<VirtualPrincipal>((callback) =>
      context.client.getVirtualPrincipal(selector, metadata, callback)),
    created);

  const page = await callUnary<ListVirtualPrincipalsResponse>((callback) =>
    context.client.listVirtualPrincipals(
      { tenantId: "acme", workspaceId: "atlas", pageSize: 100 },
      metadata,
      callback));
  assert.equal(
    page.principals.some((principal) =>
      principal.principalId === principalId),
    true);

  const disabled = await callUnary<VirtualPrincipal>((callback) =>
    context.client.setVirtualPrincipalEnabled(
      { ...selector, expectedRevision: 1n, enabled: false },
      metadata,
      callback));
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.revision, 2n);
  assert.deepEqual(
    await callUnary<VirtualPrincipal>((callback) =>
      context.client.setVirtualPrincipalEnabled(
        { ...selector, expectedRevision: 2n, enabled: false },
        metadata,
        callback)),
    disabled);

  await assert.rejects(
    callUnary<VirtualPrincipal>((callback) =>
      context.client.setVirtualPrincipalEnabled(
        { ...selector, expectedRevision: 1n, enabled: true },
        metadata,
        callback)),
    matchGrpcStatus(status.ABORTED));
  await assert.rejects(
    callUnary<VirtualPrincipal>((callback) =>
      context.client.getVirtualPrincipal(
        { principalId, tenantId: "acme", workspaceId: "beta" },
        metadata,
        callback)),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    callUnary<VirtualPrincipal>((callback) =>
      context.client.createVirtualPrincipal(
        {
          principalId,
          subjectAccountId: "user:alice",
          tenantId: "acme",
          workspaceId: "beta"
        },
        metadata,
        callback)),
    matchGrpcStatus(status.ALREADY_EXISTS));
});

test("virtual principal creation requires attached-account standing",
  async () => {
    const context = getIdentitydTestContext();
    const principalId = "agent:missing_workspace_standing";
    const resourcePath =
      "/tenants/acme/workspaces/atlas/virtual-principals/"
      + principalId;
    await allowIdentityCapabilities(context, [
      capability("virtual_principals.create", resourcePath, "atlas")
    ]);

    await assert.rejects(
      callUnary<VirtualPrincipal>((done) =>
        context.client.createVirtualPrincipal(
          {
            tenantId: "acme",
            workspaceId: "atlas",
            principalId,
            subjectAccountId: "user:bob"
          },
          identityAdminMetadata(context, "acme"),
          done)),
      matchGrpcStatus(status.NOT_FOUND));
  });

function capability(
  operation: string,
  resourcePath: string,
  workspaceId: string
) {
  return { operation, resourcePath, tenantId: "acme", workspaceId };
}

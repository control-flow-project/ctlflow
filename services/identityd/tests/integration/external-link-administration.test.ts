import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  status
} from "@grpc/grpc-js";
import type {
  ExternalIdentityLink,
  ListExternalIdentityLinksResponse
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

test("administers exact external identity mappings", async () => {
  const context = getIdentitydTestContext();
  const resourcePath =
    "/tenants/acme/login-providers/oidc/identity-links";
  await allowIdentityCapabilities(context, [
    capability("external_identity_links.create", resourcePath),
    capability("external_identity_links.read", resourcePath),
    capability("external_identity_links.delete", resourcePath)
  ]);
  const metadata = identityAdminMetadata(context, "acme");
  const mapping = {
    tenantId: "acme",
    providerId: "oidc",
    providerSubject: "admin-flow@example.com",
    accountId: "user:alice"
  };

  const created = await callUnary<ExternalIdentityLink>((callback) =>
    context.client.createExternalIdentityLink(
      mapping,
      metadata,
      callback));
  assert.deepEqual(created, { ...mapping, revision: 1n });
  assert.deepEqual(
    await callUnary<ExternalIdentityLink>((callback) =>
      context.client.createExternalIdentityLink(
        mapping,
        metadata,
        callback)),
    created);

  await assert.rejects(
    callUnary<ExternalIdentityLink>((callback) =>
      context.client.createExternalIdentityLink(
        { ...mapping, accountId: "user:bob" },
        metadata,
        callback)),
    matchGrpcStatus(status.ALREADY_EXISTS));

  const maximumSubject = "\u{1F642}".repeat(512);
  assert.equal(
    (await callUnary<ExternalIdentityLink>((callback) =>
      context.client.createExternalIdentityLink(
        { ...mapping, providerSubject: maximumSubject },
        metadata,
        callback))).providerSubject,
    maximumSubject);
  await assert.rejects(
    callUnary<ExternalIdentityLink>((callback) =>
      context.client.createExternalIdentityLink(
        { ...mapping, providerSubject: "\u{1F642}".repeat(513) },
        metadata,
        callback)),
    matchGrpcStatus(status.INVALID_ARGUMENT));

  const page = await callUnary<ListExternalIdentityLinksResponse>((callback) =>
    context.client.listExternalIdentityLinks(
      { tenantId: "acme", providerId: "oidc", pageSize: 2 },
      metadata,
      callback));
  assert.equal(page.links.length, 2);
  assert.notEqual(page.nextAfterProviderSubject, undefined);

  await assert.rejects(
    callUnary<ExternalIdentityLink>((callback) =>
      context.client.createExternalIdentityLink(
        {
          ...mapping,
          providerSubject: "service-login@example.com",
          accountId: "service:automation"
        },
        metadata,
        callback)),
    matchGrpcStatus(status.FAILED_PRECONDITION));

  await callUnary((callback) =>
    context.client.deleteExternalIdentityLink(
      {
        tenantId: mapping.tenantId,
        providerId: mapping.providerId,
        providerSubject: mapping.providerSubject
      },
      metadata,
      callback));
  await callUnary((callback) =>
    context.client.deleteExternalIdentityLink(
      {
        tenantId: mapping.tenantId,
        providerId: mapping.providerId,
        providerSubject: mapping.providerSubject
      },
      metadata,
      callback));
  await callUnary((callback) =>
    context.client.deleteExternalIdentityLink(
      {
        tenantId: mapping.tenantId,
        providerId: mapping.providerId,
        providerSubject: maximumSubject
      },
      metadata,
      callback));
});

test("external links require an enabled human member and non-deleted provider",
  async () => {
    const context = getIdentitydTestContext();
    const oidcPath =
      "/tenants/acme/login-providers/oidc/identity-links";
    const deletedPath =
      "/tenants/acme/login-providers/admin_oidc/identity-links";
    await allowIdentityCapabilities(context, [
      capability("external_identity_links.create", oidcPath),
      capability("external_identity_links.create", deletedPath)
    ]);
    const metadata = identityAdminMetadata(context, "acme");

    await assert.rejects(
      callUnary<ExternalIdentityLink>((done) =>
        context.client.createExternalIdentityLink(
          {
            tenantId: "acme",
            providerId: "oidc",
            providerSubject: "disabled-link@example.com",
            accountId: "user:disabled"
          },
          metadata,
          done)),
      matchGrpcStatus(status.FAILED_PRECONDITION));
    await assert.rejects(
      callUnary<ExternalIdentityLink>((done) =>
        context.client.createExternalIdentityLink(
          {
            tenantId: "acme",
            providerId: "admin_oidc",
            providerSubject: "deleted-provider@example.com",
            accountId: "user:alice"
          },
          metadata,
          done)),
      matchGrpcStatus(status.FAILED_PRECONDITION));
  });

function capability(operation: string, resourcePath: string) {
  return { operation, resourcePath, tenantId: "acme" };
}

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

test("external-link audit uses opaque per-link correlation IDs", async () => {
  const context = getIdentitydTestContext();
  const resourcePath =
    "/tenants/acme/login-providers/oidc/identity-links";
  await allowIdentityCapabilities(context, [
    capability("external_identity_links.create", resourcePath),
    capability("external_identity_links.delete", resourcePath)
  ]);
  const metadata = identityAdminMetadata(context, "acme");
  const subjects = [
    "audit-correlation-one@example.com",
    "audit-correlation-two@example.com"
  ] as const;
  const before = new Set(
    (await context.auditd.readEvents()).map((event) => event.sourceEventId));
  for (const providerSubject of subjects) {
    await callUnary((done) => context.client.createExternalIdentityLink(
      {
        tenantId: "acme",
        providerId: "oidc",
        providerSubject,
        accountId: "user:alice"
      },
      metadata,
      done));
    await callUnary((done) => context.client.deleteExternalIdentityLink(
      { tenantId: "acme", providerId: "oidc", providerSubject },
      metadata,
      done));
  }

  const evidence = (await context.auditd.readEvents())
    .filter((event) => !before.has(event.sourceEventId));
  const external = evidence.filter((event) =>
    event.detailKind === "identity_external_link");
  assert.equal(external.length, 4);
  const actions = new Map<string, string[]>();
  for (const event of external) {
    assert.match(event.externalLinkId, /^eil_[a-f0-9]{32}$/u);
    assert.equal(event.providerId, "oidc");
    assert.equal(event.humanAccountPrincipalId, "user:alice");
    const current = actions.get(event.externalLinkId) ?? [];
    current.push(event.action);
    actions.set(event.externalLinkId, current);
  }
  assert.equal(actions.size, 2);
  for (const linkActions of actions.values()) {
    assert.deepEqual(linkActions.sort(), ["created", "deleted"]);
  }
  const serialized = JSON.stringify(evidence);
  for (const subject of subjects) {
    assert.equal(serialized.includes(subject), false);
  }
});

test("external-link pagination follows SQLite UTF-8 byte order", async () => {
  const context = getIdentitydTestContext();
  const resourcePath =
    "/tenants/acme/login-providers/oidc/identity-links";
  await allowIdentityCapabilities(context, [
    capability("external_identity_links.create", resourcePath),
    capability("external_identity_links.read", resourcePath),
    capability("external_identity_links.delete", resourcePath)
  ]);
  const metadata = identityAdminMetadata(context, "acme");
  const subjects = ["unicode-\uE000", "unicode-\u{1F642}"] as const;
  try {
    for (const providerSubject of subjects) {
      await callUnary<ExternalIdentityLink>((done) =>
        context.client.createExternalIdentityLink(
          {
            tenantId: "acme",
            providerId: "oidc",
            providerSubject,
            accountId: "user:alice"
          },
          metadata,
          done));
    }

    const returned: string[] = [];
    let afterProviderSubject: string | undefined;
    do {
      const page = await callUnary<ListExternalIdentityLinksResponse>(
        (done) => context.client.listExternalIdentityLinks(
          {
            tenantId: "acme",
            providerId: "oidc",
            pageSize: 1,
            ...(afterProviderSubject === undefined
              ? {}
              : { afterProviderSubject })
          },
          metadata,
          done));
      assert.equal(page.links.length, 1);
      returned.push(page.links[0]!.providerSubject);
      afterProviderSubject = page.nextAfterProviderSubject;
    } while (afterProviderSubject !== undefined);

    assert.deepEqual(
      returned,
      [...returned].sort((left, right) => Buffer.compare(
        Buffer.from(left, "utf8"),
        Buffer.from(right, "utf8"))));
    assert.ok(returned.indexOf(subjects[0]) < returned.indexOf(subjects[1]));
  } finally {
    for (const providerSubject of subjects) {
      await callUnary((done) => context.client.deleteExternalIdentityLink(
        { tenantId: "acme", providerId: "oidc", providerSubject },
        metadata,
        done));
    }
  }
});

function capability(operation: string, resourcePath: string) {
  return { operation, resourcePath, tenantId: "acme" };
}

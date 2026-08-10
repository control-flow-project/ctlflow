import type {
  InvocationAuthority
} from "./invocation-authority.js";
import type {
  TestDatabase
} from "./test-database.js";
import {
  VerificationKeyAlgorithm
} from "../generated/v1/identityd.js";

export async function seedIdentityDatabase(
  database: TestDatabase,
  invocation: InvocationAuthority
): Promise<void> {
  await database.connection.transaction(async (transaction) => {
    await transaction("accounts").insert([
      account("user:alice", 1, true, 1),
      account("user:bob", 1, true, 2),
      account("user:disabled", 1, false, 3),
      account("service:automation", 2, true, 4),
      account("service:disabled", 2, false, 5)
    ]);
    await transaction("virtual_principals").insert([
      {
        principal_id: "agent:reviewer",
        subject_account_id: "user:alice",
        enabled: 1,
        revision: 11,
        tenant_fence_id: "acme",
        workspace_fence_id: null
      },
      {
        principal_id: "agent:atlas",
        subject_account_id: "service:automation",
        enabled: 1,
        revision: 12,
        tenant_fence_id: "acme",
        workspace_fence_id: "atlas"
      },
      {
        principal_id: "agent:disabled",
        subject_account_id: "user:alice",
        enabled: 0,
        revision: 13,
        tenant_fence_id: "acme",
        workspace_fence_id: null
      },
      {
        principal_id: "agent:disabled-account",
        subject_account_id: "service:disabled",
        enabled: 1,
        revision: 14,
        tenant_fence_id: "acme",
        workspace_fence_id: null
      }
    ]);
    await transaction("tenant_memberships").insert([
      membership("user:alice", "acme", 21),
      membership("user:alice", "globex", 22),
      membership("user:bob", "acme", 23),
      membership("user:disabled", "acme", 24),
      membership("service:automation", "acme", 25),
      membership("service:disabled", "acme", 26)
    ]);
    await transaction("workspace_memberships").insert([
      workspaceMembership("user:alice", "acme", "atlas", 31),
      workspaceMembership("user:alice", "acme", "beta", 32),
      workspaceMembership(
        "service:automation",
        "acme",
        "atlas",
        33),
      workspaceMembership(
        "service:disabled",
        "acme",
        "atlas",
        34)
    ]);
    await transaction("groups").insert([
      group("tenant_admins", "acme", null),
      group("tenant_readers", "acme", null),
      group("atlas_editors", "acme", "atlas"),
      group("atlas_readers", "acme", "atlas"),
      group("atlas_reviewers", "acme", "atlas"),
      group("beta_readers", "acme", "beta"),
      group("globex_readers", "globex", null)
    ]);
    await transaction("account_group_memberships").insert([
      accountGroup("user:alice", "tenant_admins"),
      accountGroup("user:alice", "tenant_readers"),
      accountGroup("user:alice", "atlas_editors"),
      accountGroup("user:alice", "atlas_readers"),
      accountGroup("user:alice", "beta_readers"),
      accountGroup("user:alice", "globex_readers"),
      accountGroup("service:automation", "atlas_readers")
    ]);
    await transaction(
      "virtual_principal_group_memberships"
    ).insert([
      virtualGroup("agent:reviewer", "tenant_readers"),
      virtualGroup("agent:reviewer", "atlas_reviewers"),
      virtualGroup("agent:atlas", "atlas_editors")
    ]);
    await transaction("login_providers").insert({
      tenant_id: "acme",
      provider_id: "oidc",
      display_name: "Acme OIDC",
      configuration_id: "oidc",
      configuration_version_id: "oidc_1",
      secret_id: "oidc_secret",
      secret_version_id: "oidc_secret_1",
      state: 1,
      revision: 40
    });
    await transaction("workspace_login_provider_admissions").insert({
      tenant_id: "acme",
      workspace_id: "atlas",
      provider_id: "oidc"
    });
    await transaction("external_identity_links").insert([
      externalIdentity(
        "acme",
        "oidc",
        "alice@example.com",
        "user:alice",
        41),
      externalIdentity(
        "acme",
        "oidc",
        "disabled@example.com",
        "user:disabled",
        42),
      externalIdentity(
        "acme",
        "oidc",
        "automation@example.com",
        "service:automation",
        43)
    ]);
    await transaction("invocation_verification_keys").insert({
      key_id: invocation.verificationKey.keyId,
      algorithm: mapVerificationKeyAlgorithm(
        invocation.verificationKey.algorithm),
      modulus_base64url:
        invocation.verificationKey.modulusBase64url,
      exponent_base64url:
        invocation.verificationKey.exponentBase64url,
      state: 1,
      revision: 1
    });
  });
}

function mapVerificationKeyAlgorithm(
  algorithm: VerificationKeyAlgorithm
): "RS256" {
  if (
    algorithm
    !== VerificationKeyAlgorithm.VERIFICATION_KEY_ALGORITHM_RS256
  ) {
    throw new Error(
      "Invocation verification-key algorithm is invalid");
  }

  return "RS256";
}

function account(
  accountId: string,
  kind: number,
  enabled: boolean,
  revision: number
): Record<string, unknown> {
  return {
    account_id: accountId,
    kind,
    enabled: enabled ? 1 : 0,
    revision
  };
}

function membership(
  accountId: string,
  tenantId: string,
  revision: number
): Record<string, unknown> {
  return {
    account_id: accountId,
    tenant_id: tenantId,
    revision
  };
}

function workspaceMembership(
  accountId: string,
  tenantId: string,
  workspaceId: string,
  revision: number
): Record<string, unknown> {
  return {
    account_id: accountId,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    revision
  };
}

function group(
  groupId: string,
  tenantId: string,
  workspaceId: string | null
): Record<string, unknown> {
  return {
    group_id: groupId,
    tenant_id: tenantId,
    workspace_id: workspaceId
  };
}

function accountGroup(
  accountId: string,
  groupId: string
): Record<string, unknown> {
  return {
    account_id: accountId,
    group_id: groupId
  };
}

function virtualGroup(
  principalId: string,
  groupId: string
): Record<string, unknown> {
  return {
    principal_id: principalId,
    group_id: groupId
  };
}

function externalIdentity(
  tenantId: string,
  providerId: string,
  providerSubject: string,
  accountId: string,
  revision: number
): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    provider_id: providerId,
    provider_subject: providerSubject,
    account_id: accountId,
    revision
  };
}

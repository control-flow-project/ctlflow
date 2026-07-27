import {
  copyFile,
  mkdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type {
  StatelessServiceFiles,
  TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  ControlledOidcProvider
} from "@ctlflow/authd/testing/provider";

export interface PreparedAuthdFiles {
  readonly directory: string;
  readonly providerConfigPath: string;
  readonly providerSecretPath: string;
  readonly deployment: StatelessServiceFiles;
}

export async function prepareAuthdFiles(
  kubernetes: TestKubernetes,
  provider: ControlledOidcProvider,
  egressBinding: string,
  identityCertificateAuthorityPath: string
): Promise<PreparedAuthdFiles> {
  const directory = path.join(
    kubernetes.storage.hostRoot,
    "authd",
    "context");
  await mkdir(directory, { recursive: true });
  const providerConfigPath = path.join(directory, "providers.json");
  const providerSecretPath = path.join(
    directory,
    "provider-credentials.json");
  const identityAuthorityPath = path.join(
    directory,
    "identityd-ca.crt");
  if (provider.publicKey.kty !== "RSA"
      || typeof provider.publicKey.n !== "string"
      || typeof provider.publicKey.e !== "string") {
    throw new Error("Provider public key is invalid");
  }
  await writeFile(
    providerConfigPath,
    `${JSON.stringify({
      schema_version: 1,
      public_origin: "https://auth.example.test",
      providers: [{
        tenant_id: "acme",
        provider_id: "oidc",
        issuer: provider.issuer,
        authorization_endpoint: provider.authorizationEndpoint,
        token_endpoint: provider.tokenEndpoint,
        userinfo_endpoint: provider.userInfoEndpoint,
        client_id: provider.clientId,
        credential_ref: "oidc-client",
        egress_binding: egressBinding,
        verification_keys: [{
          kid: provider.keyId,
          kty: "RSA",
          use: "sig",
          alg: "RS256",
          n: provider.publicKey.n,
          e: provider.publicKey.e
        }]
      }]
    }, null, 2)}\n`,
    { mode: 0o644 });
  await writeFile(
    providerSecretPath,
    `${JSON.stringify({
      schema_version: 1,
      credentials: [{
        credential_ref: "oidc-client",
        client_secret: provider.clientSecret
      }]
    }, null, 2)}\n`,
    { mode: 0o600 });
  await copyFile(
    identityCertificateAuthorityPath,
    identityAuthorityPath);
  return {
    directory,
    providerConfigPath,
    providerSecretPath,
    deployment: {
      config: { "providers.json": providerConfigPath },
      secret: {
        "provider-credentials.json": providerSecretPath
      },
      trust: { "identityd-ca.crt": identityAuthorityPath }
    }
  };
}

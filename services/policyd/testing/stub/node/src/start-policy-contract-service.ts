import {
  randomUUID
} from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  buildNodeTestImage,
  createTestServiceTls,
  startNodeTestService,
  type TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  PolicyContractService
} from "./policy-contract-service.js";
import type {
  PolicySourceConfiguration
} from "./policy-source-configuration.js";
import type {
  PolicyTestSource
} from "./policy-test-source.js";
import {
  requestPolicyControl
} from "./request-policyd-control.js";

const serviceName = "policyd-test";

export interface StartPolicyContractServiceOptions {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly identityEndpoint: string;
  readonly identityServerName: string;
  readonly identityCertificateAuthorityPath: string;
  readonly invocationIssuer: string;
  readonly invocationAudience: string;
  readonly invocationMaximumLifetimeSeconds: number;
}

export async function startPolicyContractService(
  options: StartPolicyContractServiceOptions
): Promise<PolicyContractService> {
  const storageDirectory = path.join(
    "dependencies",
    `${serviceName}-${randomUUID()}`);
  const directory = path.join(
    options.kubernetes.storage.hostRoot,
    storageDirectory);
  await mkdir(directory, {
    recursive: true
  });
  const workload =
    await options.kubernetes.createWorkloadCredentials();
  const workloadJwksPath = path.join(
    directory,
    "workload-jwks.json");
  await writeFile(
    workloadJwksPath,
    await readFile(workload.jwksPath),
    { mode: 0o644 });
  const identityCaPath = path.join(
    directory,
    "identityd-ca.pem");
  await writeFile(
    identityCaPath,
    await readFile(
      options.identityCertificateAuthorityPath),
    { mode: 0o644 });
  const tls = await createTestServiceTls(
    options.repositoryRoot,
    directory,
    serviceName,
    [
      serviceName,
      `${serviceName}.${options.kubernetes.namespace}`,
      `${serviceName}.${options.kubernetes.namespace}.svc`
    ]);
  const image = await buildNodeTestImage({
    repositoryRoot: options.repositoryRoot,
    imageName: serviceName,
    containerfilePath: path.join(
      options.repositoryRoot,
      "services/policyd/testing/stub/node/Containerfile"),
    sourcePaths: [
      path.join(options.repositoryRoot, "testing/mesh"),
      path.join(
        options.repositoryRoot,
        "services/identityd/api"),
      path.join(options.repositoryRoot, "services/policyd")
    ],
    kubernetes: options.kubernetes
  });
  const service = await startNodeTestService({
    kubernetes: options.kubernetes,
    name: serviceName,
    image,
    storageDirectory,
    workloadTokenAudience: workload.audience,
    environment: {
      CTLFLOW_TEST_POLICY_GRPC_PORT: "50051",
      CTLFLOW_TEST_POLICY_CONTROL_PORT: "8080",
      CTLFLOW_TEST_TLS_CERTIFICATE_PATH:
        `/ctlflow-context/${path.basename(tls.certificatePath)}`,
      CTLFLOW_TEST_TLS_PRIVATE_KEY_PATH:
        `/ctlflow-context/${path.basename(tls.privateKeyPath)}`,
      CTLFLOW_TEST_WORKLOAD_TOKEN_ISSUER: workload.issuer,
      CTLFLOW_TEST_WORKLOAD_TOKEN_AUDIENCE: workload.audience,
      CTLFLOW_TEST_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "600",
      CTLFLOW_TEST_WORKLOAD_JWKS_PATH:
        `/ctlflow-context/${path.basename(workloadJwksPath)}`,
      CTLFLOW_TEST_OUTBOUND_WORKLOAD_TOKEN_PATH:
        "/var/run/secrets/ctlflow/token",
      CTLFLOW_TEST_IDENTITY_URL: options.identityEndpoint,
      CTLFLOW_TEST_IDENTITY_TLS_SERVER_NAME:
        options.identityServerName,
      CTLFLOW_TEST_IDENTITY_TLS_CA_PATH:
        `/ctlflow-context/${path.basename(identityCaPath)}`,
      CTLFLOW_TEST_IDENTITY_CALL_TIMEOUT_MILLISECONDS:
        "2000",
      CTLFLOW_TEST_INVOCATION_TOKEN_ISSUER:
        options.invocationIssuer,
      CTLFLOW_TEST_INVOCATION_TOKEN_AUDIENCE:
        options.invocationAudience,
      CTLFLOW_TEST_INVOCATION_TOKEN_MAX_LIFETIME_SECONDS:
        String(options.invocationMaximumLifetimeSeconds)
    }
  });

  let stopped = false;
  return {
    endpoint: service.endpoint,
    certificateAuthorityPath: tls.certificateAuthorityPath,
    serverName: tls.serverName,
    identityCallerSubject:
      `system:serviceaccount:${options.kubernetes.namespace}:`
      + serviceName,
    createSource: async (configuration) =>
      await createSource(
        service.controlEndpoint,
        configuration),
    reconnectIdentity: async () => {
      await requestPolicyControl<void>(
        service.controlEndpoint,
        "/identity/reconnect",
        { method: "POST" });
    },
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      await service.stop();
    }
  };
}

async function createSource(
  controlEndpoint: string,
  configuration: PolicySourceConfiguration
): Promise<PolicyTestSource> {
  const sourceId =
    `source_${randomUUID().replaceAll("-", "")}`;
  await requestPolicyControl<void>(
    controlEndpoint,
    "/sources",
    {
      method: "POST",
      body: {
        sourceId,
        ...configuration
      }
    });

  let stopped = false;
  return {
    sourceId,
    setMode: async (mode) => {
      await requestPolicyControl<void>(
        controlEndpoint,
        `/sources/${sourceId}/mode`,
        {
          method: "PUT",
          body: { mode }
        });
    },
    setGrants: async (grants) => {
      await requestPolicyControl<void>(
        controlEndpoint,
        `/sources/${sourceId}/grants`,
        {
          method: "PUT",
          body: grants
        });
    },
    readRequests: async () =>
      await requestPolicyControl(
        controlEndpoint,
        `/sources/${sourceId}/requests`),
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      await requestPolicyControl<void>(
        controlEndpoint,
        `/sources/${sourceId}`,
        { method: "DELETE" });
    }
  };
}

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
  IdentitydContractService
} from "./identityd-contract-service.js";
import type {
  IdentitydMode
} from "./identityd-mode.js";
import type {
  IdentitydRequestEvidence
} from "./identityd-request-evidence.js";
import type {
  IdentitydTestSource
} from "./identityd-test-source.js";
import type {
  InvocationVerificationKeyResponse
} from "./invocation-verification-key.js";
import {
  requestIdentitydControl
} from "./request-identityd-control.js";

const serviceName = "identityd-test";

export interface StartIdentitydContractServiceOptions {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
}

export async function startIdentitydContractService(
  options: StartIdentitydContractServiceOptions
): Promise<IdentitydContractService> {
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
      "services/identityd/testing/stub/node/Containerfile"),
    sourcePaths: [
      path.join(options.repositoryRoot, "testing/mesh"),
      path.join(options.repositoryRoot, "services/identityd")
    ],
    kubernetes: options.kubernetes
  });
  const service = await startNodeTestService({
    kubernetes: options.kubernetes,
    name: serviceName,
    image,
    storageDirectory,
    environment: {
      CTLFLOW_TEST_IDENTITY_GRPC_PORT: "50051",
      CTLFLOW_TEST_IDENTITY_CONTROL_PORT: "8080",
      CTLFLOW_TEST_TLS_CERTIFICATE_PATH:
        `/ctlflow-context/${path.basename(tls.certificatePath)}`,
      CTLFLOW_TEST_TLS_PRIVATE_KEY_PATH:
        `/ctlflow-context/${path.basename(tls.privateKeyPath)}`,
      CTLFLOW_TEST_WORKLOAD_TOKEN_ISSUER: workload.issuer,
      CTLFLOW_TEST_WORKLOAD_TOKEN_AUDIENCE: workload.audience,
      CTLFLOW_TEST_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "600",
      CTLFLOW_TEST_WORKLOAD_JWKS_PATH:
        `/ctlflow-context/${path.basename(workloadJwksPath)}`
    }
  });

  let stopped = false;
  return {
    endpoint: service.endpoint,
    certificateAuthorityPath: tls.certificateAuthorityPath,
    serverName: tls.serverName,
    createSource: async (callerSubject, response) =>
      await createSource(
        service.controlEndpoint,
        callerSubject,
        response),
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
  callerSubject: string,
  response: InvocationVerificationKeyResponse
): Promise<IdentitydTestSource> {
  const sourceId =
    `source_${randomUUID().replaceAll("-", "")}`;
  await requestIdentitydControl<void>(
    controlEndpoint,
    "/sources",
    {
      method: "POST",
      body: {
        sourceId,
        callerSubject,
        response
      }
    });

  let stopped = false;
  return {
    sourceId,
    setMode: async (mode: IdentitydMode) => {
      await requestIdentitydControl<void>(
        controlEndpoint,
        `/sources/${sourceId}/mode`,
        {
          method: "PUT",
          body: { mode }
        });
    },
    setResponse: async (nextResponse) => {
      await requestIdentitydControl<void>(
        controlEndpoint,
        `/sources/${sourceId}/response`,
        {
          method: "PUT",
          body: nextResponse
        });
    },
    readRequests: async () =>
      await requestIdentitydControl<
        readonly IdentitydRequestEvidence[]
      >(
        controlEndpoint,
        `/sources/${sourceId}/requests`),
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      await requestIdentitydControl<void>(
        controlEndpoint,
        `/sources/${sourceId}`,
        { method: "DELETE" });
    }
  };
}

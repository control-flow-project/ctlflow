import { randomUUID } from "node:crypto";
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
  AuditdContractService
} from "./auditd-contract-service.js";
import type {
  AuditEventEvidence
} from "./audit-event-evidence.js";
import type {
  AuditdMode
} from "./auditd-mode.js";
import type {
  AuditdTestSource
} from "./auditd-test-source.js";
import {
  requestAuditdControl
} from "./request-auditd-control.js";

const serviceName = "auditd-test";

export interface StartAuditdContractServiceOptions {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
}

export async function startAuditdContractService(
  options: StartAuditdContractServiceOptions
): Promise<AuditdContractService> {
  const storageDirectory = path.join(
    "dependencies",
    `${serviceName}-${randomUUID()}`);
  const directory = path.join(
    options.kubernetes.storage.hostRoot,
    storageDirectory);
  await mkdir(directory, { recursive: true });
  const workload = await options.kubernetes.createWorkloadCredentials();
  const workloadJwksPath = path.join(directory, "workload-jwks.json");
  await writeFile(
    workloadJwksPath,
    await readFile(workload.jwksPath),
    { mode: 0o644 });
  const dnsNames = [
    serviceName,
    `${serviceName}.${options.kubernetes.namespace}`,
    `${serviceName}.${options.kubernetes.namespace}.svc`
  ];
  const tls = await createTestServiceTls(
    options.repositoryRoot,
    directory,
    serviceName,
    dnsNames);
  const image = await buildNodeTestImage({
    repositoryRoot: options.repositoryRoot,
    imageName: serviceName,
    containerfilePath: path.join(
      options.repositoryRoot,
      "services/auditd/testing/stub/node/Containerfile"),
    sourcePaths: [
      path.join(options.repositoryRoot, "testing/mesh"),
      path.join(options.repositoryRoot, "services/auditd")
    ],
    kubernetes: options.kubernetes
  });
  const service = await startNodeTestService({
    kubernetes: options.kubernetes,
    name: serviceName,
    image,
    storageDirectory,
    environment: {
      CTLFLOW_TEST_AUDIT_GRPC_PORT: "50051",
      CTLFLOW_TEST_AUDIT_CONTROL_PORT: "8080",
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
    createSource: async (callerSubject) =>
      await createSource(
        service.controlEndpoint,
        callerSubject),
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
  callerSubject: string
): Promise<AuditdTestSource> {
  const sourceId = `source_${randomUUID().replaceAll("-", "")}`;
  await requestAuditdControl<void>(
    controlEndpoint,
    "/sources",
    {
      method: "POST",
      body: {
        sourceId,
        callerSubject
      }
    });

  let stopped = false;
  return {
    sourceId,
    setMode: async (mode: AuditdMode) => {
      await requestAuditdControl<void>(
        controlEndpoint,
        `/sources/${sourceId}/mode`,
        {
          method: "PUT",
          body: { mode }
        });
    },
    readEvents: async () => {
      const events = await requestAuditdControl<Array<
        Omit<AuditEventEvidence, "resourceRevision"> & {
          readonly resourceRevision: string;
        }
      >>(
        controlEndpoint,
        `/sources/${sourceId}/events`);
      return events.map((event) => ({
        ...event,
        resourceRevision: BigInt(event.resourceRevision)
      }));
    },
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      await requestAuditdControl<void>(
        controlEndpoint,
        `/sources/${sourceId}`,
        { method: "DELETE" });
    }
  };
}

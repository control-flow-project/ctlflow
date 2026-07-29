import {
  randomUUID
} from "node:crypto";
import {
  copyFile,
  mkdir
} from "node:fs/promises";
import path from "node:path";
import {
  buildNodeTestImage,
  createTestServiceTls,
  startNodeTestService,
  type TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  ControlledOrigin
} from "./controlled-origin.js";
import type {
  OriginRequestEvidence
} from "./origin-request-evidence.js";
import {
  requestOriginControl
} from "./request-origin-control.js";

const servicePort = 8443;
const controlPort = 8080;

export async function startControlledOrigin(
  repositoryRoot: string,
  kubernetes: TestKubernetes
): Promise<ControlledOrigin> {
  const name = "egress-origin";
  const serverName =
    `${name}.${kubernetes.namespace}.svc`;
  const storageDirectory = path.join(
    "dependencies",
    `egress-origin-${randomUUID()}`);
  const directory = path.join(
    kubernetes.storage.hostRoot,
    storageDirectory);
  await mkdir(directory, { recursive: true });
  const tls = await createTestServiceTls(
    repositoryRoot,
    directory,
    name,
    [serverName]);
  const certificatePath = path.join(directory, "origin.crt");
  const privateKeyPath = path.join(directory, "origin.key");
  await copyFile(tls.certificatePath, certificatePath);
  await copyFile(tls.privateKeyPath, privateKeyPath);
  const image = await buildNodeTestImage({
    repositoryRoot,
    kubernetes,
    imageName: "egress-origin",
    containerfilePath: path.join(
      repositoryRoot,
      "services/egressd/testing/origin/node/Containerfile"),
    sourcePaths: [
      path.join(repositoryRoot, "tooling/clean-directories.mjs"),
      path.join(repositoryRoot, "testing/mesh"),
      path.join(repositoryRoot, "services/egressd")
    ]
  });
  const service = await startNodeTestService({
    kubernetes,
    name,
    image,
    storageDirectory,
    servicePort,
    controlPort,
    serviceScheme: "https",
    environment: {
      CTLFLOW_TEST_ORIGIN_SERVICE_PORT: String(servicePort),
      CTLFLOW_TEST_ORIGIN_CONTROL_PORT: String(controlPort),
      CTLFLOW_TEST_ORIGIN_CERTIFICATE_PATH:
        "/ctlflow-context/origin.crt",
      CTLFLOW_TEST_ORIGIN_PRIVATE_KEY_PATH:
        "/ctlflow-context/origin.key"
    }
  });
  return {
    endpoint: service.endpoint,
    serverName,
    certificateAuthorityPath: tls.certificateAuthorityPath,
    clearEvidence: async () => {
      await requestOriginControl<void>(
        service.controlEndpoint,
        "/evidence",
        { method: "DELETE" });
    },
    readEvidence: async () =>
      await requestOriginControl<
        readonly OriginRequestEvidence[]
      >(service.controlEndpoint, "/evidence"),
    setAvailable: async (available) => {
      await requestOriginControl<void>(
        service.controlEndpoint,
        "/availability",
        { method: "PUT", body: { available } });
    },
    stop: service.stop
  };
}

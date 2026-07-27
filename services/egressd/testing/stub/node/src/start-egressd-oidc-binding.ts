import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir
} from "node:fs/promises";
import path from "node:path";
import {
  buildNodeTestImage,
  startNodeTestService,
  type TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  EgressdOidcBinding
} from "./egressd-oidc-binding.js";
import type {
  EgressRequestEvidence
} from "./egress-request-evidence.js";
import type {
  EgressdMode
} from "./egressd-mode.js";
import {
  requestEgressdControl
} from "./request-egressd-control.js";

const proxyPort = 8080;
const controlPort = 8081;

export interface StartEgressdOidcBindingOptions {
  readonly repositoryRoot: string;
  readonly kubernetes: TestKubernetes;
  readonly bindingName: string;
  readonly upstreamEndpoint: string;
  readonly upstreamServerName: string;
  readonly upstreamCertificateAuthorityPath: string;
}

export async function startEgressdOidcBinding(
  options: StartEgressdOidcBindingOptions
): Promise<EgressdOidcBinding> {
  const upstream = new URL(options.upstreamEndpoint);
  if (upstream.protocol !== "https:"
      || upstream.pathname !== "/"
      || upstream.search.length !== 0
      || upstream.hash.length !== 0) {
    throw new Error("Egressd OIDC upstream must be an HTTPS origin");
  }
  const storageDirectory = path.join(
    "dependencies",
    `egressd-${randomUUID()}`);
  const directory = path.join(
    options.kubernetes.storage.hostRoot,
    storageDirectory);
  await mkdir(directory, { recursive: true });
  const authorityPath = path.join(directory, "provider-ca.crt");
  await copyFile(
    options.upstreamCertificateAuthorityPath,
    authorityPath);
  const image = await buildNodeTestImage({
    repositoryRoot: options.repositoryRoot,
    kubernetes: options.kubernetes,
    imageName: "egressd-oidc-binding",
    containerfilePath: path.join(
      options.repositoryRoot,
      "services/egressd/testing/stub/node/Containerfile"),
    sourcePaths: [
      path.join(
        options.repositoryRoot,
        "tooling/clean-directories.mjs"),
      path.join(options.repositoryRoot, "testing/mesh"),
      path.join(options.repositoryRoot, "services/egressd")
    ]
  });
  const service = await startNodeTestService({
    kubernetes: options.kubernetes,
    name: options.bindingName,
    image,
    storageDirectory,
    servicePort: proxyPort,
    controlPort,
    serviceScheme: "http",
    environment: {
      CTLFLOW_TEST_EGRESS_PROXY_PORT: String(proxyPort),
      CTLFLOW_TEST_EGRESS_CONTROL_PORT: String(controlPort),
      CTLFLOW_TEST_EGRESS_UPSTREAM_ORIGIN:
        options.upstreamEndpoint,
      CTLFLOW_TEST_EGRESS_UPSTREAM_AUTHORITY: upstream.host,
      CTLFLOW_TEST_EGRESS_UPSTREAM_SERVER_NAME:
        options.upstreamServerName,
      CTLFLOW_TEST_EGRESS_UPSTREAM_CA_PATH:
        `/ctlflow-context/${path.basename(authorityPath)}`
    }
  });

  return {
    bindingName: options.bindingName,
    endpoint: service.endpoint,
    setMode: async (mode: EgressdMode) => {
      await requestEgressdControl<void>(
        service.controlEndpoint,
        "/mode",
        { method: "PUT", body: { mode } });
    },
    clearEvidence: async () => {
      await requestEgressdControl<void>(
        service.controlEndpoint,
        "/evidence",
        { method: "DELETE" });
    },
    readEvidence: async () =>
      await requestEgressdControl<
        readonly EgressRequestEvidence[]
      >(service.controlEndpoint, "/evidence"),
    stop: service.stop
  };
}

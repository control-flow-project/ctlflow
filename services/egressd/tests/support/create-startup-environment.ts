import {
  findAvailablePort
} from "@ctlflow/test-mesh";
import type {
  EgressdTestSuite
} from "../suite/egressd-test-suite.js";
import type {
  StartupFiles
} from "./write-startup-files.js";

export async function createStartupEnvironment(
  suite: EgressdTestSuite,
  files: StartupFiles
): Promise<Readonly<Record<string, string>>> {
  const privatePort = await findAvailablePort();
  let probePort = await findAvailablePort();
  while (probePort === privatePort) {
    probePort = await findAvailablePort();
  }
  return {
    CTLFLOW_PRIVATE_URL: `http://127.0.0.1:${String(privatePort)}`,
    CTLFLOW_PROBE_URL: `http://127.0.0.1:${String(probePort)}`,
    CTLFLOW_EGRESS_BINDING_PATH: files.bindingPath,
    CTLFLOW_EGRESS_SECRETS_PATH: files.secretsPath,
    CTLFLOW_WORKLOAD_TOKEN_ISSUER: suite.caller.issuer,
    CTLFLOW_WORKLOAD_TOKEN_AUDIENCE: suite.caller.audience,
    CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "600",
    CTLFLOW_WORKLOAD_JWKS_PATH: files.workloadJwksPath,
    CTLFLOW_UPSTREAM_TLS_CA_PATH:
      files.upstreamCertificateAuthorityPath,
    CTLFLOW_UPSTREAM_TIMEOUT_MILLISECONDS: "2000",
    OTEL_EXPORTER_OTLP_ENDPOINT: suite.collector.endpoint
  };
}

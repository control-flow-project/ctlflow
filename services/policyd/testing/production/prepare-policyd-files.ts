import {
  chmod,
  copyFile
} from "node:fs/promises";
import path from "node:path";
import {
  createTestServiceTls,
  type KustomizeServiceFiles,
  type TestKubernetes,
  type TestServiceTls,
  type TestWorkloadCredentials
} from "@ctlflow/test-mesh";

export interface PreparedPolicydFiles {
  readonly certificateAuthorityPath: string;
  readonly serverName: string;
  readonly deployment: KustomizeServiceFiles;
}

export async function preparePolicydFiles(
  repositoryRoot: string,
  directory: string,
  serviceName: string,
  workload: TestWorkloadCredentials,
  kubernetes: TestKubernetes,
  identityCertificateAuthorityPath: string,
  executionCertificateAuthorityPath?: string,
  suppliedTls?: TestServiceTls
): Promise<PreparedPolicydFiles> {
  const tls = suppliedTls ?? await createTestServiceTls(
    repositoryRoot,
    directory,
    serviceName,
    [
      serviceName,
      `${serviceName}.${kubernetes.namespace}`,
      `${serviceName}.${kubernetes.namespace}.svc`
    ]);
  const workloadJwksPath = path.join(
    directory,
    "workload-jwks.json");
  const identityAuthorityPath = path.join(
    directory,
    "identityd-ca.crt");
  await copyFile(workload.jwksPath, workloadJwksPath);
  await copyFile(
    identityCertificateAuthorityPath,
    identityAuthorityPath);
  await chmod(workloadJwksPath, 0o644);
  await chmod(identityAuthorityPath, 0o644);
  // The execution CA: real when the suite deploys Execd, otherwise the
  // identityd CA stands in so the required trust file exists and the product
  // branch fails closed on the unreachable endpoint.
  const executionAuthorityPath = path.join(
    directory,
    "execd-ca.crt");
  await copyFile(
    executionCertificateAuthorityPath ?? identityCertificateAuthorityPath,
    executionAuthorityPath);
  await chmod(executionAuthorityPath, 0o644);

  return {
    certificateAuthorityPath: tls.certificateAuthorityPath,
    serverName: tls.serverName,
    deployment: {
      secret: {
        "tls.crt": tls.certificatePath,
        "tls.key": tls.privateKeyPath
      },
      trust: {
        "workload-jwks.json": workloadJwksPath,
        "identityd-ca.crt": identityAuthorityPath,
        "execd-ca.crt": executionAuthorityPath
      }
    }
  };
}

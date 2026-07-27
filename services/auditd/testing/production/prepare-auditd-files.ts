import {
  chmod,
  copyFile
} from "node:fs/promises";
import path from "node:path";
import {
  createTestServiceTls,
  type KustomizeServiceFiles,
  type TestKubernetes,
  type TestWorkloadCredentials
} from "@ctlflow/test-mesh";

export interface PreparedAuditdFiles {
  readonly certificateAuthorityPath: string;
  readonly serverName: string;
  readonly deployment: KustomizeServiceFiles;
}

export async function prepareAuditdFiles(
  repositoryRoot: string,
  directory: string,
  workload: TestWorkloadCredentials,
  kubernetes: TestKubernetes
): Promise<PreparedAuditdFiles> {
  const serviceName = "auditd";
  const tls = await createTestServiceTls(
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
  await copyFile(workload.jwksPath, workloadJwksPath);
  await chmod(workloadJwksPath, 0o644);

  return {
    certificateAuthorityPath: tls.certificateAuthorityPath,
    serverName: tls.serverName,
    deployment: {
      secret: {
        "tls.crt": tls.certificatePath,
        "tls.key": tls.privateKeyPath
      },
      trust: {
        "workload-jwks.json": workloadJwksPath
      }
    }
  };
}

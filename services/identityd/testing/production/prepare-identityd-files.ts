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
import type {
  InvocationSigningProvision
} from "./start-identityd-production-service-options.js";

export interface PreparedIdentitydFiles {
  readonly certificateAuthorityPath: string;
  readonly serverName: string;
  readonly deployment: KustomizeServiceFiles;
}

export async function prepareIdentitydFiles(
  repositoryRoot: string,
  directory: string,
  serviceName: string,
  workload: TestWorkloadCredentials,
  kubernetes: TestKubernetes,
  auditCertificateAuthorityPath: string,
  signing: InvocationSigningProvision
): Promise<PreparedIdentitydFiles> {
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
  const auditAuthorityPath = path.join(
    directory,
    "auditd-ca.crt");
  const signingKeyPath = path.join(
    directory,
    "invocation-signing.pem");
  await copyFile(workload.jwksPath, workloadJwksPath);
  await copyFile(
    auditCertificateAuthorityPath,
    auditAuthorityPath);
  await signing.writePrivateKey(signingKeyPath);
  await chmod(workloadJwksPath, 0o644);
  await chmod(auditAuthorityPath, 0o644);
  await chmod(signingKeyPath, 0o600);

  return {
    certificateAuthorityPath: tls.certificateAuthorityPath,
    serverName: tls.serverName,
    deployment: {
      secret: {
        "tls.crt": tls.certificatePath,
        "tls.key": tls.privateKeyPath,
        "invocation-signing.pem": signingKeyPath
      },
      trust: {
        "workload-jwks.json": workloadJwksPath,
        "auditd-ca.crt": auditAuthorityPath
      }
    }
  };
}

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
  InvocationAuthority
} from "./invocation-authority.js";

export interface IdentitydContextFiles {
  readonly workloadJwks: string;
  readonly serverCertificateAuthorityPath: string;
  readonly serverName: string;
  readonly deployment: KustomizeServiceFiles;
}

export async function prepareIdentitydContextFiles(
  repositoryRoot: string,
  directory: string,
  serviceName: string,
  workload: TestWorkloadCredentials,
  kubernetes: TestKubernetes,
  auditCertificateAuthorityPath: string,
  policyCertificateAuthorityPath: string,
  signing: InvocationAuthority
): Promise<IdentitydContextFiles> {
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
  const policyAuthorityPath = path.join(
    directory,
    "policyd-ca.crt");
  const signingKeyPath = path.join(
    directory,
    "invocation-signing.pem");
  await copyFile(workload.jwksPath, workloadJwksPath);
  await copyFile(
    auditCertificateAuthorityPath,
    auditAuthorityPath);
  await copyFile(
    policyCertificateAuthorityPath,
    policyAuthorityPath);
  await signing.writePrivateKey(signingKeyPath);
  await chmod(workloadJwksPath, 0o644);
  await chmod(auditAuthorityPath, 0o644);
  await chmod(policyAuthorityPath, 0o644);
  await chmod(signingKeyPath, 0o600);

  return {
    workloadJwks: "/var/run/ctlflow/trust/workload-jwks.json",
    serverCertificateAuthorityPath: tls.certificateAuthorityPath,
    serverName: tls.serverName,
    deployment: {
      secret: {
        "tls.crt": tls.certificatePath,
        "tls.key": tls.privateKeyPath,
        "invocation-signing.pem": signingKeyPath
      },
      trust: {
        "workload-jwks.json": workloadJwksPath,
        "auditd-ca.crt": auditAuthorityPath,
        "policyd-ca.crt": policyAuthorityPath
      }
    }
  };
}

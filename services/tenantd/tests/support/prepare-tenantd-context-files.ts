import {
  chmod,
  copyFile
} from "node:fs/promises";
import path from "node:path";
import type {
  KustomizeServiceFiles,
  TestKubernetes,
  TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import {
  createTestServiceTls
} from "@ctlflow/test-mesh";
import type {
  AuditdProductionService
} from "@ctlflow/auditd/testing/production";
import type {
  IdentitydProductionService
} from "@ctlflow/identityd/testing/production";
import type {
  PolicyContractService
} from "@ctlflow/policyd/testing/stub";

export interface TenantdContextFiles {
  readonly workloadJwks: string;
  readonly serverCertificate: string;
  readonly serverPrivateKey: string;
  readonly serverCertificateAuthorityPath: string;
  readonly serverName: string;
  readonly kubernetesClientCertificateAuthority: string;
  readonly auditCertificateAuthority: string;
  readonly identityCertificateAuthority: string;
  readonly policyCertificateAuthority: string;
  readonly deployment: KustomizeServiceFiles;
}

export interface PrepareTenantdContextFilesOptions {
  readonly repositoryRoot: string;
  readonly directory: string;
  readonly serviceName: string;
  readonly workload: TestWorkloadCredentials;
  readonly kubernetes: TestKubernetes;
  readonly auditd: AuditdProductionService;
  readonly identityd: IdentitydProductionService;
  readonly policyd: PolicyContractService;
}

export async function prepareTenantdContextFiles(
  options: PrepareTenantdContextFilesOptions
): Promise<TenantdContextFiles> {
  const tls = await createTestServiceTls(
    options.repositoryRoot,
    options.directory,
    options.serviceName,
    [
      options.serviceName,
      `${options.serviceName}.${options.kubernetes.namespace}`,
      `${options.serviceName}.${options.kubernetes.namespace}.svc`
    ]);
  const copies = [
    {
      source: options.workload.jwksPath,
      name: "workload-jwks.json"
    },
    {
      source:
        options.kubernetes.api.certificateAuthorityPath,
      name: "kubernetes-client-ca.crt"
    },
    {
      source: options.auditd.certificateAuthorityPath,
      name: "auditd-ca.crt"
    },
    {
      source: options.identityd.certificateAuthorityPath,
      name: "identityd-ca.crt"
    },
    {
      source: options.policyd.certificateAuthorityPath,
      name: "policyd-ca.crt"
    }
  ] as const;
  for (const file of copies) {
    const destination = path.join(
      options.directory,
      file.name);
    await copyFile(file.source, destination);
    await chmod(destination, 0o644);
  }

  return {
    workloadJwks:
      "/var/run/ctlflow/trust/workload-jwks.json",
    serverCertificate:
      "/var/run/ctlflow/tls/tls.crt",
    serverPrivateKey:
      "/var/run/ctlflow/tls/tls.key",
    serverCertificateAuthorityPath:
      tls.certificateAuthorityPath,
    serverName: tls.serverName,
    kubernetesClientCertificateAuthority:
      "/var/run/ctlflow/trust/kubernetes-client-ca.crt",
    auditCertificateAuthority:
      "/var/run/ctlflow/trust/auditd-ca.crt",
    identityCertificateAuthority:
      "/var/run/ctlflow/trust/identityd-ca.crt",
    policyCertificateAuthority:
      "/var/run/ctlflow/trust/policyd-ca.crt",
    deployment: {
      secret: {
        "tls.crt": tls.certificatePath,
        "tls.key": tls.privateKeyPath
      },
      trust: {
        "workload-jwks.json": path.join(
          options.directory,
          "workload-jwks.json"),
        "kubernetes-client-ca.crt": path.join(
          options.directory,
          "kubernetes-client-ca.crt"),
        "auditd-ca.crt": path.join(
          options.directory,
          "auditd-ca.crt"),
        "identityd-ca.crt": path.join(
          options.directory,
          "identityd-ca.crt"),
        "policyd-ca.crt": path.join(
          options.directory,
          "policyd-ca.crt")
      }
    }
  };
}

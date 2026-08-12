import {
  chmod,
  copyFile
} from "node:fs/promises";
import path from "node:path";
import {
  createTestServiceTls,
  type TestKubernetes,
  type TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import type {
  AuditdProductionService
} from "@ctlflow/auditd/testing/production";
import type {
  IdentitydProductionService
} from "@ctlflow/identityd/testing/production";
import type {
  PolicydProductionService
} from "@ctlflow/policyd/testing/production";
import type {
  TenantdFiles
} from "./tenantd-files.js";

export interface PrepareTenantdFilesOptions {
  readonly repositoryRoot: string;
  readonly directory: string;
  readonly serviceName: string;
  readonly workload: TestWorkloadCredentials;
  readonly kubernetes: TestKubernetes;
  readonly auditd: AuditdProductionService;
  readonly identityd: IdentitydProductionService;
  readonly policyd: PolicydProductionService;
}

export async function prepareTenantdFiles(
  options: PrepareTenantdFilesOptions
): Promise<TenantdFiles> {
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
    { source: options.workload.jwksPath, name: "workload-jwks.json" },
    {
      source: options.kubernetes.api.certificateAuthorityPath,
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
    const destination = path.join(options.directory, file.name);
    await copyFile(file.source, destination);
    await chmod(destination, 0o644);
  }

  return {
    workloadJwks: "/var/run/ctlflow/trust/workload-jwks.json",
    serverCertificate: "/var/run/ctlflow/tls/tls.crt",
    serverPrivateKey: "/var/run/ctlflow/tls/tls.key",
    serverCertificateAuthorityPath: tls.certificateAuthorityPath,
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
      trust: Object.fromEntries(copies.map((file) => [
        file.name,
        path.join(options.directory, file.name)
      ]))
    }
  };
}

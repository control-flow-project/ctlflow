import {
  chmod,
  copyFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  randomBytes
} from "node:crypto";
import {
  createTestServiceTls,
  type KustomizeServiceFiles,
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

export interface ConfigdContextFiles {
  readonly workloadJwks: string;
  readonly serverCertificate: string;
  readonly serverPrivateKey: string;
  readonly serverCertificateAuthorityPath: string;
  readonly serverName: string;
  readonly kubernetesClientCertificateAuthority: string;
  readonly kubernetesApiCertificateAuthority: string;
  readonly encryptionKeyRing: string;
  readonly auditCertificateAuthority: string;
  readonly identityCertificateAuthority: string;
  readonly policyCertificateAuthority: string;
  readonly deployment: KustomizeServiceFiles;
}

export interface PrepareConfigdContextFilesOptions {
  readonly repositoryRoot: string;
  readonly directory: string;
  readonly serviceName: string;
  readonly workload: TestWorkloadCredentials;
  readonly kubernetes: TestKubernetes;
  readonly auditd: AuditdProductionService;
  readonly identityd: IdentitydProductionService;
  readonly policyd: PolicydProductionService;
}

export async function prepareConfigdContextFiles(
  options: PrepareConfigdContextFilesOptions
): Promise<ConfigdContextFiles> {
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
      source:
        options.kubernetes.api.certificateAuthorityPath,
      name: "kubernetes-api-ca.crt"
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

  const encryptionKeyRingPath = path.join(
    options.directory,
    "encryption-key-ring.json");
  await writeFile(
    encryptionKeyRingPath,
    JSON.stringify({
      active_key_id: "config_primary",
      keys: [{
        key_id: "config_primary",
        key_base64: randomBytes(32).toString("base64")
      }]
    }),
    { mode: 0o600 });

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
    kubernetesApiCertificateAuthority:
      "/var/run/ctlflow/trust/kubernetes-api-ca.crt",
    encryptionKeyRing:
      "/var/run/ctlflow/tls/encryption-key-ring.json",
    auditCertificateAuthority:
      "/var/run/ctlflow/trust/auditd-ca.crt",
    identityCertificateAuthority:
      "/var/run/ctlflow/trust/identityd-ca.crt",
    policyCertificateAuthority:
      "/var/run/ctlflow/trust/policyd-ca.crt",
    deployment: {
      secret: {
        "tls.crt": tls.certificatePath,
        "tls.key": tls.privateKeyPath,
        "encryption-key-ring.json": encryptionKeyRingPath
      },
      trust: {
        "workload-jwks.json": path.join(
          options.directory,
          "workload-jwks.json"),
        "kubernetes-client-ca.crt": path.join(
          options.directory,
          "kubernetes-client-ca.crt"),
        "kubernetes-api-ca.crt": path.join(
          options.directory,
          "kubernetes-api-ca.crt"),
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

import type {
  KustomizeServiceFiles
} from "@ctlflow/test-mesh";

export interface TenantdFiles {
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

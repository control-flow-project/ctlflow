import type {
  OpenTelemetryCollector,
  TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import type {
  ConfigdContextFiles
} from "./prepare-configd-context-files.js";
import type {
  InvocationAuthority
} from "./invocation-authority.js";
import type {
  TestDatabase
} from "./test-database.js";

export interface ConfigdCallers {
  readonly capability: TestWorkloadCredentials;
  readonly readOnlyCapability: TestWorkloadCredentials;
  readonly provisioner: TestWorkloadCredentials;
  readonly execd: TestWorkloadCredentials;
}

export function createConfigdEnvironment(
  collector: OpenTelemetryCollector,
  auditEndpoint: string,
  identityEndpoint: string,
  policyEndpoint: string,
  database: TestDatabase,
  callers: ConfigdCallers,
  invocation: InvocationAuthority,
  files: ConfigdContextFiles,
  auditServerName: string,
  identityServerName: string,
  policyServerName: string,
  operatorSubject: string
): Readonly<Record<string, string>> {
  return {
    CTLFLOW_GRPC_URL: "https://0.0.0.0:50051",
    CTLFLOW_PROBE_URL: "http://0.0.0.0:8080",
    CTLFLOW_TLS_CERTIFICATE_PATH:
      files.serverCertificate,
    CTLFLOW_TLS_PRIVATE_KEY_PATH:
      files.serverPrivateKey,
    CTLFLOW_KUBERNETES_CLIENT_CA_PATH:
      files.kubernetesClientCertificateAuthority,
    CTLFLOW_DATABASE_PROVIDER: "sqlite",
    CTLFLOW_DATABASE_PATH: database.containerPath,
    CTLFLOW_DATABASE_POOL_SIZE: "8",
    CTLFLOW_CONFIGD_ENCRYPTION_KEY_RING_PATH:
      files.encryptionKeyRing,
    CTLFLOW_KUBERNETES_API_URL:
      "https://kubernetes.default.svc:443",
    CTLFLOW_KUBERNETES_API_CA_PATH:
      files.kubernetesApiCertificateAuthority,
    CTLFLOW_KUBERNETES_API_TOKEN_FILE:
      "/var/run/secrets/ctlflow/kubernetes-token",
    CTLFLOW_KUBERNETES_API_CALL_TIMEOUT_MILLISECONDS: "2000",
    CTLFLOW_WORKLOAD_TOKEN_FILE:
      "/var/run/secrets/ctlflow/token",
    CTLFLOW_AUDIT_URL: auditEndpoint,
    CTLFLOW_AUDIT_TLS_SERVER_NAME: auditServerName,
    CTLFLOW_AUDIT_TLS_CA_PATH:
      files.auditCertificateAuthority,
    CTLFLOW_AUDIT_CALL_TIMEOUT_MILLISECONDS: "500",
    CTLFLOW_IDENTITY_URL: identityEndpoint,
    CTLFLOW_IDENTITY_TLS_SERVER_NAME:
      identityServerName,
    CTLFLOW_IDENTITY_TLS_CA_PATH:
      files.identityCertificateAuthority,
    CTLFLOW_IDENTITY_CALL_TIMEOUT_MILLISECONDS: "2000",
    CTLFLOW_POLICY_URL: policyEndpoint,
    CTLFLOW_POLICY_TLS_SERVER_NAME:
      policyServerName,
    CTLFLOW_POLICY_TLS_CA_PATH:
      files.policyCertificateAuthority,
    CTLFLOW_POLICY_CALL_TIMEOUT_MILLISECONDS: "2000",
    CTLFLOW_WORKLOAD_TOKEN_ISSUER:
      callers.execd.issuer,
    CTLFLOW_WORKLOAD_TOKEN_AUDIENCE:
      callers.execd.audience,
    CTLFLOW_WORKLOAD_JWKS_PATH: files.workloadJwks,
    CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "600",
    CTLFLOW_INVOCATION_TOKEN_ISSUER: invocation.issuer,
    CTLFLOW_INVOCATION_TOKEN_AUDIENCE: invocation.audience,
    CTLFLOW_INVOCATION_TOKEN_MAX_LIFETIME_SECONDS: "60",
    CTLFLOW_OPERATOR_SUBJECTS: operatorSubject,
    CTLFLOW_PUBLISH_CONFIGURATION_PROVISIONER_CALLERS:
      callers.provisioner.callerSubject,
    CTLFLOW_PUBLISH_CONFIGURATION_CAPABILITY_CALLERS:
      callers.capability.callerSubject,
    CTLFLOW_RESOLVE_CONFIGURATION_CAPABILITY_CALLERS:
      [
        callers.capability.callerSubject,
        callers.readOnlyCapability.callerSubject
      ].join(","),
    CTLFLOW_PUBLISH_SECRET_PROVISIONER_CALLERS:
      callers.provisioner.callerSubject,
    CTLFLOW_PUBLISH_SECRET_CAPABILITY_CALLERS:
      callers.capability.callerSubject,
    CTLFLOW_GET_SECRET_METADATA_CAPABILITY_CALLERS:
      [
        callers.capability.callerSubject,
        callers.readOnlyCapability.callerSubject
      ].join(","),
    CTLFLOW_APPLY_PROJECTION_EXECD_CALLERS:
      callers.execd.callerSubject,
    OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint
  };
}

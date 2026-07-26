import {
  credentials,
  type ClientOptions
} from "@grpc/grpc-js";
import {
  readFile
} from "node:fs/promises";
import {
  type OpenTelemetryCollector,
  type TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import type {
  AuditdTestSource
} from "@ctlflow/auditd/testing/stub";
import type {
  IdentitydTestSource
} from "@ctlflow/identityd/testing/stub";
import {
  TenantServiceClient
} from "../generated/v1/tenantd.js";
import {
  getTenantdTestSuite
} from "../suite/get-tenantd-test-suite.js";
import {
  createInvocationAuthority
} from "./create-invocation-authority.js";
import {
  createTestDatabase
} from "./create-test-database.js";
import {
  prepareTenantdContextFiles,
  type TenantdContextFiles
} from "./prepare-tenantd-context-files.js";
import {
  type TenantdRunningService
} from "../runtime/tenantd-test-runtime.js";
import type {
  InvocationAuthority
} from "./invocation-authority.js";
import type {
  TestDatabase
} from "./test-database.js";

const serviceName = "tenantd";

export interface TenantdTestContext {
  readonly workload: TestWorkloadCredentials;
  readonly collector: OpenTelemetryCollector;
  readonly invocation: InvocationAuthority;
  readonly auditd: AuditdTestSource;
  readonly identityd: IdentitydTestSource;
  readonly database: TestDatabase;
  readonly service: TenantdRunningService;
  readonly client: TenantServiceClient;
  readonly workloadClient: TenantServiceClient;
  readonly unadmittedOperatorClient: TenantServiceClient;
  readonly operatorSubject: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly grpcPort: number;
  readonly probePort: number;
  readonly stop: () => Promise<void>;
}

export async function createTenantdTestContext():
Promise<TenantdTestContext> {
  const suite = getTenantdTestSuite();
  let database: TestDatabase | undefined;
  let auditd: AuditdTestSource | undefined;
  let identityd: IdentitydTestSource | undefined;
  let service: TenantdRunningService | undefined;
  const clients: TenantServiceClient[] = [];

  try {
    await suite.collector.resume();
    await suite.collector.clearExports();
    const workload =
      await suite.kubernetes.createWorkloadCredentials();
    const invocation = await createInvocationAuthority();
    database = await createTestDatabase(
      suite.kubernetes.storage);
    const serviceAccountSubject =
      `system:serviceaccount:${suite.kubernetes.namespace}:`
      + serviceName;
    auditd = await suite.auditd.createSource(
      serviceAccountSubject);
    identityd = await suite.identityd.createSource(
      serviceAccountSubject,
      {
        keys: [invocation.verificationKey],
        expiresAt: new Date(
          Date.now() + 4 * 60_000).toISOString()
      });
    const files = await prepareTenantdContextFiles({
      repositoryRoot: suite.repositoryRoot,
      directory: database.directory,
      serviceName,
      workload,
      kubernetes: suite.kubernetes,
      auditd: suite.auditd,
      identityd: suite.identityd
    });
    const environment = createEnvironment(
      suite.collector,
      suite.auditd.endpoint,
      suite.identityd.endpoint,
      database,
      workload,
      invocation,
      files,
      suite.auditd.serverName,
      suite.identityd.serverName,
      suite.kubernetes.api.clientSubject);

    service = await suite.runtime.start({
      kubernetes: suite.kubernetes,
      name: serviceName,
      storageDirectory: database.storageDirectory,
      environment,
      files: files.deployment
    });
    const unadmitted =
      await suite.kubernetes.createOperatorCredentials(
        "unadmitted-operator");
    const endpoint =
      `127.0.0.1:${String(service.grpcPort)}`;
    const options = createClientOptions(files.serverName);
    const serverAuthority = await readFile(
      files.serverCertificateAuthorityPath);
    const client = new TenantServiceClient(
      endpoint,
      credentials.createSsl(
        serverAuthority,
        await readFile(
          suite.kubernetes.api.clientKeyPath),
        await readFile(
          suite.kubernetes.api.clientCertificatePath)),
      options);
    const workloadClient = new TenantServiceClient(
      endpoint,
      credentials.createSsl(serverAuthority),
      options);
    const unadmittedOperatorClient =
      new TenantServiceClient(
        endpoint,
        credentials.createSsl(
          serverAuthority,
          await readFile(unadmitted.privateKeyPath),
          await readFile(unadmitted.certificatePath)),
        options);
    clients.push(
      client,
      workloadClient,
      unadmittedOperatorClient);

    let stopped = false;
    return {
      workload,
      collector: suite.collector,
      invocation,
      auditd,
      identityd,
      database,
      service,
      client,
      workloadClient,
      unadmittedOperatorClient,
      operatorSubject:
        suite.kubernetes.api.clientSubject,
      environment,
      grpcPort: service.grpcPort,
      probePort: service.probePort,
      stop: async () => {
        if (stopped) {
          return;
        }
        stopped = true;
        for (const current of clients) {
          current.close();
        }
        await stopResources(
          service,
          database,
          auditd,
          identityd);
      }
    };
  } catch (error) {
    for (const client of clients) {
      client.close();
    }
    await stopResources(
      service,
      database,
      auditd,
      identityd).catch(() => undefined);
    throw error;
  }
}

function createEnvironment(
  collector: OpenTelemetryCollector,
  auditEndpoint: string,
  identityEndpoint: string,
  database: TestDatabase,
  workload: TestWorkloadCredentials,
  invocation: InvocationAuthority,
  files: TenantdContextFiles,
  auditServerName: string,
  identityServerName: string,
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
    CTLFLOW_IDENTITY_CALL_TIMEOUT_MILLISECONDS: "500",
    CTLFLOW_WORKLOAD_TOKEN_ISSUER: workload.issuer,
    CTLFLOW_WORKLOAD_TOKEN_AUDIENCE: workload.audience,
    CTLFLOW_WORKLOAD_JWKS_PATH: files.workloadJwks,
    CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "600",
    CTLFLOW_INVOCATION_TOKEN_ISSUER: invocation.issuer,
    CTLFLOW_INVOCATION_TOKEN_AUDIENCE: invocation.audience,
    CTLFLOW_INVOCATION_TOKEN_MAX_LIFETIME_SECONDS: "60",
    CTLFLOW_OPERATOR_SUBJECTS: operatorSubject,
    CTLFLOW_GET_TENANT_CALLERS:
      workload.callerSubject,
    CTLFLOW_GET_WORKSPACE_CALLERS:
      workload.callerSubject,
    CTLFLOW_RESOLVE_TENANT_CALLERS:
      workload.callerSubject,
    CTLFLOW_RESOLVE_WORKSPACE_CALLERS:
      workload.callerSubject,
    OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint
  };
}

function createClientOptions(serverName: string): ClientOptions {
  return {
    "grpc.ssl_target_name_override": serverName,
    "grpc.default_authority": serverName
  };
}

async function stopResources(
  service: TenantdRunningService | undefined,
  database: TestDatabase | undefined,
  auditd: AuditdTestSource | undefined,
  identityd: IdentitydTestSource | undefined
): Promise<void> {
  let failure: unknown;

  for (const stop of [
    service?.stop,
    identityd?.stop,
    auditd?.stop,
    database?.stop
  ]) {
    if (stop === undefined) {
      continue;
    }
    try {
      await stop();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) {
    throw failure;
  }
}

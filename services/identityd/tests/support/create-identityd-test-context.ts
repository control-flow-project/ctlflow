import {
  credentials,
  type ClientOptions
} from "@grpc/grpc-js";
import {
  readFile
} from "node:fs/promises";
import type {
  OpenTelemetryCollector,
  TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import type {
  AuditdTestSource
} from "@ctlflow/auditd/testing/stub";
import {
  IdentityServiceClient
} from "../generated/v1/identityd.js";
import type {
  IdentitydRunningService
} from "../runtime/identityd-test-runtime.js";
import {
  getIdentitydTestSuite
} from "../suite/get-identityd-test-suite.js";
import {
  createInvocationAuthority
} from "./create-invocation-authority.js";
import {
  createTestDatabase
} from "./create-test-database.js";
import type {
  InvocationAuthority
} from "./invocation-authority.js";
import {
  prepareIdentitydContextFiles
} from "./prepare-identityd-context-files.js";
import {
  seedIdentityDatabase
} from "./seed-identity-database.js";
import type {
  TestDatabase
} from "./test-database.js";

const serviceName = "identityd";

export interface IdentitydTestContext {
  readonly authdWorkload: TestWorkloadCredentials;
  readonly edgedWorkload: TestWorkloadCredentials;
  readonly execdWorkload: TestWorkloadCredentials;
  readonly policydWorkload: TestWorkloadCredentials;
  readonly tenantdWorkload: TestWorkloadCredentials;
  readonly auditd: AuditdTestSource;
  readonly collector: OpenTelemetryCollector;
  readonly invocation: InvocationAuthority;
  readonly database: TestDatabase;
  readonly service: IdentitydRunningService;
  readonly client: IdentityServiceClient;
  readonly environment: Readonly<Record<string, string>>;
  readonly grpcPort: number;
  readonly probePort: number;
  readonly stop: () => Promise<void>;
}

export async function createIdentitydTestContext():
Promise<IdentitydTestContext> {
  const suite = getIdentitydTestSuite();
  let database: TestDatabase | undefined;
  let service: IdentitydRunningService | undefined;
  let client: IdentityServiceClient | undefined;
  let auditd: AuditdTestSource | undefined;

  try {
    await suite.collector.resume();
    await suite.collector.clearExports();
    const authdWorkload =
      await suite.kubernetes.createWorkloadCredentials("authd");
    const edgedWorkload =
      await suite.kubernetes.createWorkloadCredentials("edged");
    const execdWorkload =
      await suite.kubernetes.createWorkloadCredentials("execd");
    const policydWorkload =
      await suite.kubernetes.createWorkloadCredentials("policyd");
    const tenantdWorkload =
      await suite.kubernetes.createWorkloadCredentials("tenantd");
    const invocation = await createInvocationAuthority(
      "identity-primary-key");
    auditd = await suite.auditd.createSource(
      `system:serviceaccount:${suite.kubernetes.namespace}:`
      + serviceName);
    database = await createTestDatabase(
      suite.kubernetes.storage);
    const files = await prepareIdentitydContextFiles(
      suite.repositoryRoot,
      database.directory,
      serviceName,
      policydWorkload,
      suite.kubernetes,
      suite.auditd.certificateAuthorityPath,
      invocation);
    const environment = createEnvironment(
      suite.collector,
      database,
      suite.auditd.endpoint,
      suite.auditd.serverName,
      invocation.verificationKey.keyId,
      authdWorkload,
      edgedWorkload,
      execdWorkload,
      policydWorkload,
      tenantdWorkload,
      invocation);
    const provisionDatabase = database;
    service = await suite.runtime.start({
      kubernetes: suite.kubernetes,
      name: serviceName,
      storageDirectory: database.storageDirectory,
      environment,
      files: files.deployment,
      provision: async () => {
        await seedIdentityDatabase(provisionDatabase, invocation);
      }
    });
    const endpoint = `127.0.0.1:${String(service.grpcPort)}`;
    const serverAuthority = await readFile(
      files.serverCertificateAuthorityPath);
    client = new IdentityServiceClient(
      endpoint,
      credentials.createSsl(serverAuthority),
      createClientOptions(files.serverName));

    let stopped = false;
    return {
      authdWorkload,
      edgedWorkload,
      execdWorkload,
      policydWorkload,
      tenantdWorkload,
      auditd,
      collector: suite.collector,
      invocation,
      database,
      service,
      client,
      environment,
      grpcPort: service.grpcPort,
      probePort: service.probePort,
      stop: async () => {
        if (stopped) {
          return;
        }

        stopped = true;
        client?.close();
        await stopResources(service, database, auditd);
      }
    };
  } catch (error) {
    client?.close();
    await stopResources(service, database, auditd)
      .catch(() => undefined);
    throw error;
  }
}

function createEnvironment(
  collector: OpenTelemetryCollector,
  database: TestDatabase,
  auditEndpoint: string,
  auditServerName: string,
  signingKeyId: string,
  authdWorkload: TestWorkloadCredentials,
  edgedWorkload: TestWorkloadCredentials,
  execdWorkload: TestWorkloadCredentials,
  policydWorkload: TestWorkloadCredentials,
  tenantdWorkload: TestWorkloadCredentials,
  invocation: InvocationAuthority
): Readonly<Record<string, string>> {
  return {
    CTLFLOW_GRPC_URL: "https://0.0.0.0:50051",
    CTLFLOW_PROBE_URL: "http://0.0.0.0:8080",
    CTLFLOW_TLS_CERTIFICATE_PATH:
      "/var/run/ctlflow/tls/tls.crt",
    CTLFLOW_TLS_PRIVATE_KEY_PATH:
      "/var/run/ctlflow/tls/tls.key",
    CTLFLOW_WORKLOAD_TOKEN_FILE:
      "/var/run/secrets/ctlflow/token",
    CTLFLOW_AUDIT_URL: auditEndpoint,
    CTLFLOW_AUDIT_TLS_SERVER_NAME: auditServerName,
    CTLFLOW_AUDIT_TLS_CA_PATH:
      "/var/run/ctlflow/trust/auditd-ca.crt",
    CTLFLOW_AUDIT_CALL_TIMEOUT_MILLISECONDS: "500",
    CTLFLOW_DATABASE_PROVIDER: "sqlite",
    CTLFLOW_DATABASE_PATH: database.containerPath,
    CTLFLOW_DATABASE_POOL_SIZE: "8",
    CTLFLOW_WORKLOAD_TOKEN_ISSUER: policydWorkload.issuer,
    CTLFLOW_WORKLOAD_TOKEN_AUDIENCE: policydWorkload.audience,
    CTLFLOW_WORKLOAD_JWKS_PATH:
      "/var/run/ctlflow/trust/workload-jwks.json",
    CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "600",
    CTLFLOW_INVOCATION_TOKEN_ISSUER: invocation.issuer,
    CTLFLOW_INVOCATION_TOKEN_AUDIENCE: invocation.audience,
    CTLFLOW_INVOCATION_TOKEN_MAX_LIFETIME_SECONDS: "60",
    CTLFLOW_INVOCATION_KEY_CACHE_SECONDS: "30",
    CTLFLOW_INVOCATION_SIGNING_KEY_ID: signingKeyId,
    CTLFLOW_INVOCATION_SIGNING_PRIVATE_KEY_PATH:
      "/var/run/ctlflow/tls/invocation-signing.pem",
    CTLFLOW_SESSION_LIFETIME_SECONDS: "43200",
    CTLFLOW_GET_INVOCATION_VERIFICATION_KEYS_CALLERS:
      [
        tenantdWorkload.callerSubject,
        policydWorkload.callerSubject
      ].join(","),
    CTLFLOW_RESOLVE_PRINCIPAL_CALLERS:
      policydWorkload.callerSubject,
    CTLFLOW_LIST_PRINCIPAL_GROUPS_CALLERS:
      policydWorkload.callerSubject,
    CTLFLOW_CREATE_SESSION_CALLERS:
      authdWorkload.callerSubject,
    CTLFLOW_EXCHANGE_SESSION_CALLERS:
      edgedWorkload.callerSubject,
    CTLFLOW_REVOKE_SESSION_CALLERS:
      authdWorkload.callerSubject,
    CTLFLOW_ISSUE_RUN_INVOCATION_CALLERS:
      execdWorkload.callerSubject,
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
  service: IdentitydRunningService | undefined,
  database: TestDatabase | undefined,
  auditd: AuditdTestSource | undefined
): Promise<void> {
  let failure: unknown;
  try {
    await service?.stop();
  } catch (error) {
    failure = error;
  }
  try {
    await auditd?.stop();
  } catch (error) {
    failure ??= error;
  }
  try {
    await database?.stop();
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) {
    throw failure;
  }
}

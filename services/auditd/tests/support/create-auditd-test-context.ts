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
import {
  AuditServiceClient
} from "../generated/v1/auditd.js";
import type {
  AuditdRunningService
} from "../runtime/auditd-test-runtime.js";
import {
  getAuditdTestSuite
} from "../suite/get-auditd-test-suite.js";
import {
  createTestDatabase
} from "./create-test-database.js";
import {
  prepareAuditdContextFiles
} from "./prepare-auditd-context-files.js";
import type {
  TestDatabase
} from "./test-database.js";

const serviceName = "auditd";

export interface AuditSourceWorkloads {
  readonly tenantd: TestWorkloadCredentials;
  readonly identityd: TestWorkloadCredentials;
  readonly pkgd: TestWorkloadCredentials;
  readonly configd: TestWorkloadCredentials;
  readonly execd: TestWorkloadCredentials;
}

export interface AuditdTestContext {
  readonly workloads: AuditSourceWorkloads;
  readonly collector: OpenTelemetryCollector;
  readonly database: TestDatabase;
  readonly service: AuditdRunningService;
  readonly client: AuditServiceClient;
  readonly environment: Readonly<Record<string, string>>;
  readonly grpcPort: number;
  readonly probePort: number;
  readonly stop: () => Promise<void>;
}

export async function createAuditdTestContext():
Promise<AuditdTestContext> {
  const suite = getAuditdTestSuite();
  let database: TestDatabase | undefined;
  let service: AuditdRunningService | undefined;
  let client: AuditServiceClient | undefined;

  try {
    await suite.collector.resume();
    await suite.collector.clearExports();
    const workloads = await createSourceWorkloads(suite);
    database = await createTestDatabase(
      suite.kubernetes.storage);
    const files = await prepareAuditdContextFiles(
      suite.repositoryRoot,
      database.directory,
      serviceName,
      workloads.tenantd,
      suite.kubernetes);
    const environment = createEnvironment(
      suite.collector,
      database,
      workloads);
    service = await suite.runtime.start({
      kubernetes: suite.kubernetes,
      name: serviceName,
      storageDirectory: database.storageDirectory,
      environment,
      files: files.deployment,
      provision: async () => undefined
    });
    const endpoint = `127.0.0.1:${String(service.grpcPort)}`;
    const serverAuthority = await readFile(
      files.serverCertificateAuthorityPath);
    client = new AuditServiceClient(
      endpoint,
      credentials.createSsl(serverAuthority),
      createClientOptions(files.serverName));

    let stopped = false;
    return {
      workloads,
      collector: suite.collector,
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
        await stopResources(service, database);
      }
    };
  } catch (error) {
    client?.close();
    await stopResources(service, database)
      .catch(() => undefined);
    throw error;
  }
}

async function createSourceWorkloads(
  suite: ReturnType<typeof getAuditdTestSuite>
): Promise<AuditSourceWorkloads> {
  return {
    tenantd: await suite.kubernetes
      .createWorkloadCredentials("tenantd"),
    identityd: await suite.kubernetes
      .createWorkloadCredentials("identityd"),
    pkgd: await suite.kubernetes
      .createWorkloadCredentials("pkgd"),
    configd: await suite.kubernetes
      .createWorkloadCredentials("configd"),
    execd: await suite.kubernetes
      .createWorkloadCredentials("execd")
  };
}

function createEnvironment(
  collector: OpenTelemetryCollector,
  database: TestDatabase,
  workloads: AuditSourceWorkloads
): Readonly<Record<string, string>> {
  return {
    CTLFLOW_GRPC_URL: "https://0.0.0.0:50051",
    CTLFLOW_PROBE_URL: "http://0.0.0.0:8080",
    CTLFLOW_TLS_CERTIFICATE_PATH:
      "/var/run/ctlflow/tls/tls.crt",
    CTLFLOW_TLS_PRIVATE_KEY_PATH:
      "/var/run/ctlflow/tls/tls.key",
    CTLFLOW_DATABASE_PROVIDER: "sqlite",
    CTLFLOW_DATABASE_PATH: database.containerPath,
    CTLFLOW_DATABASE_POOL_SIZE: "8",
    CTLFLOW_WORKLOAD_TOKEN_ISSUER: workloads.tenantd.issuer,
    CTLFLOW_WORKLOAD_TOKEN_AUDIENCE: workloads.tenantd.audience,
    CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "600",
    CTLFLOW_WORKLOAD_KEY_CACHE_SECONDS: "30",
    CTLFLOW_WORKLOAD_JWKS_PATH:
      "/var/run/ctlflow/trust/workload-jwks.json",
    CTLFLOW_SOURCE_TENANTD_SUBJECT:
      workloads.tenantd.callerSubject,
    CTLFLOW_SOURCE_IDENTITYD_SUBJECT:
      workloads.identityd.callerSubject,
    CTLFLOW_SOURCE_PKGD_SUBJECT:
      workloads.pkgd.callerSubject,
    CTLFLOW_SOURCE_CONFIGD_SUBJECT:
      workloads.configd.callerSubject,
    CTLFLOW_SOURCE_EXECD_SUBJECT:
      workloads.execd.callerSubject,
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
  service: AuditdRunningService | undefined,
  database: TestDatabase | undefined
): Promise<void> {
  let failure: unknown;
  try {
    await service?.stop();
  } catch (error) {
    failure = error;
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

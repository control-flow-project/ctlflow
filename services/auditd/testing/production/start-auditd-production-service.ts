import path from "node:path";
import {
  buildNodeTestImage,
  publishContainerizedCSharpService,
  startCSharpService,
  type CSharpService
} from "@ctlflow/test-mesh";
import type {
  AuditdMode
} from "./auditd-mode.js";
import type {
  AuditdProductionService
} from "./auditd-production-service.js";
import type {
  AuditdProductionSource
} from "./auditd-production-source.js";
import {
  createAuditTestDatabase
} from "./create-audit-test-database.js";
import {
  prepareAuditdFiles
} from "./prepare-auditd-files.js";
import {
  readAuditEvents
} from "./evidence/read-audit-events.js";
import type {
  StartAuditdProductionServiceOptions
} from "./start-auditd-production-service-options.js";
import type {
  AuditTestDatabase
} from "./audit-test-database.js";

const serviceName = "auditd";
const executableName = "CtlFlow.Audit.Auditd.Service";
const sourceServices = [
  "tenantd",
  "identityd",
  "pkgd",
  "configd",
  "execd"
] as const;
type SourceService = typeof sourceServices[number];

interface AuditdControlState {
  databaseLocked: boolean;
}

export async function startAuditdProductionService(
  options: StartAuditdProductionServiceOptions
): Promise<AuditdProductionService> {
  const serviceRoot = path.join(
    options.repositoryRoot,
    "services",
    serviceName);
  const csharpRoot = path.join(serviceRoot, "csharp");
  const publication = await publishContainerizedCSharpService({
    repositoryRoot: options.repositoryRoot,
    projectPath: path.join(
      csharpRoot,
      "src",
      executableName,
      `${executableName}.csproj`),
    diagnosticsManifestPath: path.join(
      csharpRoot,
      "nativeaot-diagnostics.json"),
    containerfilePath: path.join(csharpRoot, "Containerfile"),
    executableName
  });
  let database: AuditTestDatabase | undefined;
  let service: CSharpService | undefined;

  try {
    database = await createAuditTestDatabase(
      options.kubernetes.storage);
    const workload =
      await options.kubernetes.createWorkloadCredentials(
        "auditd-bootstrap");
    const files = await prepareAuditdFiles(
      options.repositoryRoot,
      database.directory,
      workload,
      options.kubernetes);
    const migrationImage = await buildNodeTestImage({
      repositoryRoot: options.repositoryRoot,
      kubernetes: options.kubernetes,
      imageName: "auditd-migrations",
      containerfilePath: path.join(
        serviceRoot,
        "migrations",
        "Containerfile"),
      sourcePaths: [
        path.join(serviceRoot, "knexfile.ts"),
        path.join(serviceRoot, "migrations"),
        path.join(serviceRoot, "package.json"),
        path.join(serviceRoot, "schema-manifest.txt"),
        path.join(serviceRoot, "tooling"),
        path.join(serviceRoot, "tsconfig.migrations.json"),
        path.join(
          options.repositoryRoot,
          "tooling",
          "clean-directories.mjs")
      ]
    });
    const baseEnvironment = createEnvironment(
      options,
      workload.issuer,
      workload.audience);
    service = await startCSharpService({
      repositoryRoot: options.repositoryRoot,
      publication,
      kubernetes: options.kubernetes,
      name: serviceName,
      imageName: serviceName,
      containerfilePath: path.join(csharpRoot, "Containerfile"),
      migrationImage,
      kustomizeBasePath: path.join(
        serviceRoot,
        "kubernetes",
        "base"),
      storageDirectory: database.storageDirectory,
      storageFilePath: "/var/lib/ctlflow/auditd.sqlite",
      environment: baseEnvironment,
      files: files.deployment
    });
    return createService(
      options,
      publication.stop,
      database,
      service,
      files.certificateAuthorityPath,
      files.serverName);
  } catch (error) {
    await service?.stop().catch(() => undefined);
    await database?.stop().catch(() => undefined);
    await publication.stop().catch(() => undefined);
    throw error;
  }
}

function createEnvironment(
  options: StartAuditdProductionServiceOptions,
  workloadIssuer: string,
  workloadAudience: string
): Readonly<Record<string, string>> {
  return {
    CTLFLOW_GRPC_URL: "https://0.0.0.0:50051",
    CTLFLOW_PROBE_URL: "http://0.0.0.0:8080",
    CTLFLOW_TLS_CERTIFICATE_PATH:
      "/var/run/ctlflow/tls/tls.crt",
    CTLFLOW_TLS_PRIVATE_KEY_PATH:
      "/var/run/ctlflow/tls/tls.key",
    CTLFLOW_DATABASE_PROVIDER: "sqlite",
    CTLFLOW_DATABASE_PATH: "/var/lib/ctlflow/auditd.sqlite",
    CTLFLOW_DATABASE_POOL_SIZE: "8",
    CTLFLOW_WORKLOAD_TOKEN_ISSUER: workloadIssuer,
    CTLFLOW_WORKLOAD_TOKEN_AUDIENCE: workloadAudience,
    CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "600",
    CTLFLOW_WORKLOAD_KEY_CACHE_SECONDS: "30",
    CTLFLOW_WORKLOAD_JWKS_PATH:
      "/var/run/ctlflow/trust/workload-jwks.json",
    ...createSourceEnvironment(
      options.kubernetes.namespace),
    OTEL_EXPORTER_OTLP_ENDPOINT: options.telemetryEndpoint
  };
}

function createService(
  options: StartAuditdProductionServiceOptions,
  stopPublication: () => Promise<void>,
  database: AuditTestDatabase,
  service: CSharpService,
  certificateAuthorityPath: string,
  serverName: string
): AuditdProductionService {
  const modes = new Map<string, AuditdMode>();
  const control: AuditdControlState = {
    databaseLocked: false
  };
  let stopped = false;
  return {
    endpoint:
      `https://${serviceName}.${options.kubernetes.namespace}.svc:50051`,
    certificateAuthorityPath,
    serverName,
    createSource: async (callerSubject) => {
      requireSourceService(options, callerSubject);
      modes.set(callerSubject, "available");
      return createSource(
        database,
        modes,
        control,
        callerSubject);
    },
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      await stopResources(
        service,
        database,
        stopPublication);
    }
  };
}

function createSource(
  database: AuditTestDatabase,
  modes: Map<string, AuditdMode>,
  control: AuditdControlState,
  callerSubject: string
): AuditdProductionSource {
  let stopped = false;
  const readEvents = async () =>
    await readAuditEvents(database.connection, callerSubject);
  return {
    setMode: async (mode) => {
      if (stopped) {
        throw new Error("Auditd production source is stopped");
      }
      modes.set(callerSubject, mode);
      await applyModes(
        database,
        modes,
        control);
    },
    readEvents,
    readTenancyEvents: async () => {
      const events = await readEvents();
      if (events.some((event) =>
        event.detailKind !== "tenant_mutation"
        && event.detailKind !== "workspace_mutation")) {
        throw new Error(
          "Audit source contains non-tenancy evidence");
      }
      return events;
    },
    readIdentitySessionEvents: async () => {
      const events = await readEvents();
      if (events.some((event) =>
        event.detailKind !== "identity_session")) {
        throw new Error(
          "Audit source contains non-identity-Session evidence");
      }
      return events;
    },
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      const previous = modes.get(callerSubject);
      modes.delete(callerSubject);
      if (previous !== undefined && previous !== "available") {
        await applyModes(
          database,
          modes,
          control);
      }
    }
  } as AuditdProductionSource;
}

async function applyModes(
  database: AuditTestDatabase,
  modes: ReadonlyMap<string, AuditdMode>,
  control: AuditdControlState
): Promise<void> {
  const unavailable = [...modes.values()].includes("unavailable");
  if (unavailable && !control.databaseLocked) {
    await database.connection.raw("BEGIN EXCLUSIVE");
    control.databaseLocked = true;
  } else if (!unavailable && control.databaseLocked) {
    await database.connection.raw("ROLLBACK");
    control.databaseLocked = false;
  }
}

function createSourceEnvironment(
  namespace: string
): Readonly<Record<string, string>> {
  return Object.fromEntries(sourceServices.map((source) => [
    `CTLFLOW_SOURCE_${source.toUpperCase()}_SUBJECT`,
    sourceSubject(namespace, source)
  ]));
}

function requireSourceService(
  options: StartAuditdProductionServiceOptions,
  callerSubject: string
): SourceService {
  for (const source of sourceServices) {
    if (callerSubject === sourceSubject(
      options.kubernetes.namespace,
      source)) {
      return source;
    }
  }
  throw new Error("Auditd caller is not an admitted source");
}

function sourceSubject(
  namespace: string,
  source: string
): string {
  return `system:serviceaccount:${namespace}:${source}`;
}

async function stopResources(
  service: CSharpService,
  database: AuditTestDatabase,
  stopPublication: () => Promise<void>
): Promise<void> {
  let failure: unknown;
  for (const stop of [
    service.stop,
    database.stop,
    stopPublication
  ]) {
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

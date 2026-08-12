import path from "node:path";
import {
  buildNodeTestImage,
  publishContainerizedCSharpService,
  startCSharpService,
  type CSharpService
} from "@ctlflow/test-mesh";
import type {
  AuditdProductionSource
} from "@ctlflow/auditd/testing/production";
import {
  createTenantdDatabase
} from "./create-tenantd-database.js";
import {
  prepareTenantdFiles
} from "./prepare-tenantd-files.js";
import {
  replaceTenancy
} from "./replace-tenancy.js";
import type {
  StartTenantdProductionServiceOptions
} from "./start-tenantd-production-service-options.js";
import type {
  TenantdProductionService
} from "./tenantd-production-service.js";
import type {
  TenantdTestDatabase
} from "./tenantd-test-database.js";

const serviceName = "tenantd";
const executableName = "CtlFlow.Tenancy.Tenantd.Service";

export async function startTenantdProductionService(
  options: StartTenantdProductionServiceOptions
): Promise<TenantdProductionService> {
  if (options.retainedRecordCallers.length === 0) {
    throw new Error("Tenantd requires a retained-record caller");
  }
  if (options.addressResolutionCallers.length === 0) {
    throw new Error("Tenantd requires an address-resolution caller");
  }
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
  let database: TenantdTestDatabase | undefined;
  let service: CSharpService | undefined;
  let auditSource: AuditdProductionSource | undefined;

  try {
    database = await createTenantdDatabase(options.kubernetes.storage);
    const workload =
      await options.kubernetes.createWorkloadCredentials(serviceName);
    auditSource = await options.auditd.createSource(
      `system:serviceaccount:${options.kubernetes.namespace}:${serviceName}`);
    const files = await prepareTenantdFiles({
      repositoryRoot: options.repositoryRoot,
      directory: database.directory,
      serviceName,
      workload,
      kubernetes: options.kubernetes,
      auditd: options.auditd,
      identityd: options.identityd,
      policyd: options.policyd
    });
    const migrationImage = await buildNodeTestImage({
      repositoryRoot: options.repositoryRoot,
      kubernetes: options.kubernetes,
      imageName: "tenantd-migrations",
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
    const environment = createEnvironment(options, workload.issuer,
      workload.audience, files);
    service = await startCSharpService({
      repositoryRoot: options.repositoryRoot,
      publication,
      kubernetes: options.kubernetes,
      name: serviceName,
      imageName: serviceName,
      containerfilePath: path.join(csharpRoot, "Containerfile"),
      migrationImage,
      kustomizeBasePath: path.join(serviceRoot, "kubernetes", "base"),
      storageDirectory: database.storageDirectory,
      storageFilePath: database.containerPath,
      environment,
      files: files.deployment
    });
    return createService(
      options,
      publication.stop,
      database,
      service,
      auditSource,
      files.serverCertificateAuthorityPath,
      files.serverName);
  } catch (error) {
    await service?.stop().catch(() => undefined);
    await auditSource?.stop().catch(() => undefined);
    await database?.stop().catch(() => undefined);
    await publication.stop().catch(() => undefined);
    throw error;
  }
}

function createEnvironment(
  options: StartTenantdProductionServiceOptions,
  workloadIssuer: string,
  workloadAudience: string,
  files: Awaited<ReturnType<typeof prepareTenantdFiles>>
): Readonly<Record<string, string>> {
  const namespace = options.kubernetes.namespace;
  const capabilityCaller =
    `system:serviceaccount:${namespace}:admin-backend`;
  return {
    CTLFLOW_GRPC_URL: "https://0.0.0.0:50051",
    CTLFLOW_PROBE_URL: "http://0.0.0.0:8080",
    CTLFLOW_TLS_CERTIFICATE_PATH: files.serverCertificate,
    CTLFLOW_TLS_PRIVATE_KEY_PATH: files.serverPrivateKey,
    CTLFLOW_KUBERNETES_CLIENT_CA_PATH:
      files.kubernetesClientCertificateAuthority,
    CTLFLOW_DATABASE_PROVIDER: "sqlite",
    CTLFLOW_DATABASE_PATH: "/var/lib/ctlflow/tenantd.sqlite",
    CTLFLOW_DATABASE_POOL_SIZE: "8",
    CTLFLOW_WORKLOAD_TOKEN_FILE: "/var/run/secrets/ctlflow/token",
    CTLFLOW_AUDIT_URL: options.auditd.endpoint,
    CTLFLOW_AUDIT_TLS_SERVER_NAME: options.auditd.serverName,
    CTLFLOW_AUDIT_TLS_CA_PATH: files.auditCertificateAuthority,
    CTLFLOW_AUDIT_CALL_TIMEOUT_MILLISECONDS: "500",
    CTLFLOW_IDENTITY_URL: options.identityd.endpoint,
    CTLFLOW_IDENTITY_TLS_SERVER_NAME: options.identityd.serverName,
    CTLFLOW_IDENTITY_TLS_CA_PATH: files.identityCertificateAuthority,
    CTLFLOW_IDENTITY_CALL_TIMEOUT_MILLISECONDS: "3000",
    CTLFLOW_POLICY_URL: options.policyd.endpoint,
    CTLFLOW_POLICY_TLS_SERVER_NAME: options.policyd.serverName,
    CTLFLOW_POLICY_TLS_CA_PATH: files.policyCertificateAuthority,
    CTLFLOW_POLICY_CALL_TIMEOUT_MILLISECONDS: "3000",
    CTLFLOW_WORKLOAD_TOKEN_ISSUER: workloadIssuer,
    CTLFLOW_WORKLOAD_TOKEN_AUDIENCE: workloadAudience,
    CTLFLOW_WORKLOAD_JWKS_PATH: files.workloadJwks,
    CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "600",
    CTLFLOW_INVOCATION_TOKEN_ISSUER: options.invocationIssuer,
    CTLFLOW_INVOCATION_TOKEN_AUDIENCE: options.invocationAudience,
    CTLFLOW_INVOCATION_TOKEN_MAX_LIFETIME_SECONDS:
      String(options.invocationMaximumLifetimeSeconds),
    CTLFLOW_OPERATOR_SUBJECTS: options.kubernetes.api.clientSubject,
    CTLFLOW_GET_TENANT_AUTONOMOUS_CALLERS:
      options.retainedRecordCallers.join(","),
    CTLFLOW_GET_TENANT_CAPABILITY_CALLERS: capabilityCaller,
    CTLFLOW_UPDATE_TENANT_CAPABILITY_CALLERS: capabilityCaller,
    CTLFLOW_CREATE_WORKSPACE_CAPABILITY_CALLERS: capabilityCaller,
    CTLFLOW_GET_WORKSPACE_AUTONOMOUS_CALLERS:
      options.retainedRecordCallers.join(","),
    CTLFLOW_GET_WORKSPACE_CAPABILITY_CALLERS: capabilityCaller,
    CTLFLOW_LIST_WORKSPACES_CAPABILITY_CALLERS: capabilityCaller,
    CTLFLOW_UPDATE_WORKSPACE_CAPABILITY_CALLERS: capabilityCaller,
    CTLFLOW_SET_WORKSPACE_STATE_CAPABILITY_CALLERS: capabilityCaller,
    CTLFLOW_RESOLVE_TENANT_AUTONOMOUS_CALLERS:
      options.addressResolutionCallers.join(","),
    CTLFLOW_RESOLVE_WORKSPACE_AUTONOMOUS_CALLERS:
      options.addressResolutionCallers.join(","),
    OTEL_EXPORTER_OTLP_ENDPOINT: options.telemetryEndpoint
  };
}

function createService(
  options: StartTenantdProductionServiceOptions,
  stopPublication: () => Promise<void>,
  database: TenantdTestDatabase,
  service: CSharpService,
  auditSource: AuditdProductionSource,
  certificateAuthorityPath: string,
  serverName: string
): TenantdProductionService {
  let suspended = false;
  let stopped = false;
  return {
    endpoint:
      `https://${serviceName}.${options.kubernetes.namespace}.svc:50051`,
    grpcPort: service.grpcPort,
    certificateAuthorityPath,
    serverName,
    replaceTenancy: (snapshot) =>
      replaceTenancy(database.connection, snapshot),
    setMode: async (mode) => {
      if (mode === "unavailable" && !suspended) {
        await scaleTenantd(options, 0);
        suspended = true;
      } else if (mode === "available" && suspended) {
        await scaleTenantd(options, 1);
        await service.reconnect();
        suspended = false;
      }
    },
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      await stopResources(
        service,
        database,
        auditSource,
        stopPublication);
    }
  };
}

async function scaleTenantd(
  options: StartTenantdProductionServiceOptions,
  replicas: 0 | 1
): Promise<void> {
  await options.kubernetes.runKubectl([
    "scale",
    `statefulset/${serviceName}`,
    "--namespace",
    options.kubernetes.namespace,
    `--replicas=${String(replicas)}`
  ]);
  if (replicas === 0) {
    await options.kubernetes.runKubectl([
      "wait",
      "--for=delete",
      `pod/${serviceName}-0`,
      "--namespace",
      options.kubernetes.namespace,
      "--timeout=30s"
    ]);
    return;
  }
  await options.kubernetes.runKubectl([
    "rollout",
    "status",
    `statefulset/${serviceName}`,
    "--namespace",
    options.kubernetes.namespace,
    "--timeout=30s"
  ]);
}

async function stopResources(
  service: CSharpService,
  database: TenantdTestDatabase,
  auditSource: AuditdProductionSource,
  stopPublication: () => Promise<void>
): Promise<void> {
  let failure: unknown;
  for (const stop of [
    service.stop,
    auditSource.stop,
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

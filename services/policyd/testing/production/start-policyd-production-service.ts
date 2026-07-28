import path from "node:path";
import {
  buildNodeTestImage,
  publishContainerizedCSharpService,
  startCSharpService,
  type CSharpService
} from "@ctlflow/test-mesh";
import type {
  IdentitydProductionSource
} from "@ctlflow/identityd/testing/production";
import {
  createPolicyDatabase,
  type PolicyTestDatabase
} from "./create-policy-database.js";
import {
  preparePolicydFiles
} from "./prepare-policyd-files.js";
import type {
  PolicydProductionService
} from "./policyd-production-service.js";
import {
  replacePolicy
} from "./replace-policy.js";
import type {
  StartPolicydProductionServiceOptions
} from "./start-policyd-production-service-options.js";

const serviceName = "policyd";
const executableName = "CtlFlow.Policy.Policyd.Service";

export async function startPolicydProductionService(
  options: StartPolicydProductionServiceOptions
): Promise<PolicydProductionService> {
  const serviceRoot = path.join(
    options.repositoryRoot,
    "services",
    "policyd");
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
    containerfilePath: path.join(
      csharpRoot,
      "Containerfile"),
    executableName
  });
  let database: PolicyTestDatabase | undefined;
  let service: CSharpService | undefined;
  let identitySource: IdentitydProductionSource | undefined;

  try {
    database = await createPolicyDatabase(options.kubernetes.storage);
    const workload =
      await options.kubernetes.createWorkloadCredentials(serviceName);
    identitySource = await options.identityd.createSource({
      callerSubject: workload.callerSubject,
      verificationKeys: options.verificationKeys,
      principalFacts: options.principalFacts
    });
    const files = await preparePolicydFiles(
      options.repositoryRoot,
      database.directory,
      serviceName,
      workload,
      options.kubernetes,
      options.identityd.certificateAuthorityPath);
    const migrationImage = await buildNodeTestImage({
      repositoryRoot: options.repositoryRoot,
      kubernetes: options.kubernetes,
      imageName: "policyd-migrations",
      containerfilePath: path.join(
        serviceRoot,
        "migrations",
        "Containerfile"),
      sourcePaths: [
        path.join(serviceRoot, "knexfile.ts"),
        path.join(serviceRoot, "kubernetes", "base", "policy-seed.json"),
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
    const environment = createEnvironment(options, workload);
    const provisionDatabase = database;
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
      storageFilePath: "/var/lib/ctlflow/policyd.sqlite",
      environment,
      files: files.deployment,
      provision: async () => {
        await replacePolicy(
          provisionDatabase.connection,
          options.policy ?? { roles: [], grants: [] });
      }
    });
    return createService(
      options,
      publication.stop,
      database,
      service,
      identitySource,
      files.certificateAuthorityPath,
      files.serverName);
  } catch (error) {
    await service?.stop().catch(() => undefined);
    await identitySource?.stop().catch(() => undefined);
    await database?.stop().catch(() => undefined);
    await publication.stop().catch(() => undefined);
    throw error;
  }
}

function createEnvironment(
  options: StartPolicydProductionServiceOptions,
  workload: {
    readonly issuer: string;
    readonly audience: string;
    readonly callerSubject: string;
  }
): Readonly<Record<string, string>> {
  const caller = (name: string) =>
    `system:serviceaccount:${options.kubernetes.namespace}:${name}`;
  return {
    CTLFLOW_GRPC_URL: "https://0.0.0.0:50051",
    CTLFLOW_PROBE_URL: "http://0.0.0.0:8080",
    CTLFLOW_TLS_CERTIFICATE_PATH:
      "/var/run/ctlflow/tls/tls.crt",
    CTLFLOW_TLS_PRIVATE_KEY_PATH:
      "/var/run/ctlflow/tls/tls.key",
    CTLFLOW_DATABASE_PROVIDER: "sqlite",
    CTLFLOW_DATABASE_PATH: "/var/lib/ctlflow/policyd.sqlite",
    CTLFLOW_DATABASE_POOL_SIZE: "8",
    CTLFLOW_WORKLOAD_TOKEN_FILE:
      "/var/run/secrets/ctlflow/token",
    CTLFLOW_IDENTITY_URL: options.identityd.endpoint,
    CTLFLOW_IDENTITY_TLS_SERVER_NAME: options.identityd.serverName,
    CTLFLOW_IDENTITY_TLS_CA_PATH:
      "/var/run/ctlflow/trust/identityd-ca.crt",
    CTLFLOW_IDENTITY_CALL_TIMEOUT_MILLISECONDS: "2000",
    CTLFLOW_WORKLOAD_TOKEN_ISSUER: workload.issuer,
    CTLFLOW_WORKLOAD_TOKEN_AUDIENCE: workload.audience,
    CTLFLOW_WORKLOAD_JWKS_PATH:
      "/var/run/ctlflow/trust/workload-jwks.json",
    CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "600",
    CTLFLOW_INVOCATION_TOKEN_ISSUER: options.invocationIssuer,
    CTLFLOW_INVOCATION_TOKEN_AUDIENCE: options.invocationAudience,
    CTLFLOW_INVOCATION_TOKEN_MAX_LIFETIME_SECONDS:
      String(options.invocationMaximumLifetimeSeconds),
    CTLFLOW_TENANTD_CALLER: caller("tenantd"),
    CTLFLOW_PKGD_CALLER: caller("pkgd"),
    CTLFLOW_CONFIGD_CALLER: caller("configd"),
    CTLFLOW_EXECD_CALLER: caller("execd"),
    CTLFLOW_OPERATION_CATALOG_PATH: "/app/operation-owners.tsv",
    OTEL_EXPORTER_OTLP_ENDPOINT: options.telemetryEndpoint
  };
}

function createService(
  options: StartPolicydProductionServiceOptions,
  stopPublication: () => Promise<void>,
  database: PolicyTestDatabase,
  service: CSharpService,
  identitySource: IdentitydProductionSource,
  certificateAuthorityPath: string,
  serverName: string
): PolicydProductionService {
  let stopped = false;
  return {
    endpoint:
      `https://${serviceName}.${options.kubernetes.namespace}.svc:50051`,
    certificateAuthorityPath,
    serverName,
    identityCallerSubject: service.serviceAccountSubject,
    database: database.connection,
    process: service,
    replacePolicy: (state) =>
      replacePolicy(database.connection, state),
    corruptPrincipalKind: identitySource.corruptPrincipalKind,
    setPrincipalFacts: identitySource.setPrincipalFacts,
    setVerificationKeys: identitySource.setVerificationKeys,
    setIdentityMode: identitySource.setMode,
    setAvailable: async (available) => {
      await scalePolicyd(options, available ? 1 : 0);
      if (available) {
        await service.reconnect();
      }
    },
    reconnectIdentity: service.restart,
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      await stopResources(
        service,
        database,
        identitySource,
        stopPublication);
    }
  };
}

async function scalePolicyd(
  options: StartPolicydProductionServiceOptions,
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
  database: PolicyTestDatabase,
  identitySource: IdentitydProductionSource,
  stopPublication: () => Promise<void>
): Promise<void> {
  let failure: unknown;
  for (const stop of [
    service.stop,
    identitySource.stop,
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

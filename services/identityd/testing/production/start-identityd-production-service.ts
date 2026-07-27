import path from "node:path";
import {
  buildNodeTestImage,
  publishContainerizedCSharpService,
  startCSharpService,
  type CSharpService
} from "@ctlflow/test-mesh";
import type {
  IdentitydMode
} from "./identityd-mode.js";
import type {
  AuditdTestSource
} from "@ctlflow/auditd/testing/stub";
import type {
  IdentitydProductionService
} from "./identityd-production-service.js";
import type {
  StartIdentitydProductionServiceOptions
} from "./start-identityd-production-service-options.js";
import {
  createIdentityDatabase,
  type IdentityTestDatabase
} from "./create-identity-database.js";
import {
  prepareIdentitydFiles
} from "./prepare-identityd-files.js";
import {
  replacePrincipalFacts
} from "./replace-principal-facts.js";
import {
  replaceExternalIdentityLinks
} from "./replace-external-identity-links.js";
import {
  replaceVerificationKeys
} from "./replace-verification-keys.js";

const serviceName = "identityd";
const executableName = "CtlFlow.Identity.Identityd.Service";

export async function startIdentitydProductionService(
  options: StartIdentitydProductionServiceOptions
): Promise<IdentitydProductionService> {
  const serviceRoot = path.join(
    options.repositoryRoot,
    "services",
    "identityd");
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
  let database: IdentityTestDatabase | undefined;
  let service: CSharpService | undefined;
  let auditSource: AuditdTestSource | undefined;

  try {
    database = await createIdentityDatabase(
      options.kubernetes.storage);
    const workload =
      await options.kubernetes.createWorkloadCredentials(
        serviceName);
    auditSource = await options.auditd.createSource(
      `system:serviceaccount:${options.kubernetes.namespace}:`
      + serviceName);
    const files = await prepareIdentitydFiles(
      options.repositoryRoot,
      database.directory,
      serviceName,
      workload,
      options.kubernetes,
      options.auditd.certificateAuthorityPath,
      options.signing);
    const migrationImage = await buildNodeTestImage({
      repositoryRoot: options.repositoryRoot,
      kubernetes: options.kubernetes,
      imageName: "identityd-migrations",
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
    const provisionDatabase = database;
    service = await startCSharpService({
      repositoryRoot: options.repositoryRoot,
      publication,
      kubernetes: options.kubernetes,
      name: serviceName,
      imageName: serviceName,
      containerfilePath: path.join(
        csharpRoot,
        "Containerfile"),
      migrationImage,
      kustomizeBasePath: path.join(
        serviceRoot,
        "kubernetes",
        "base"),
      storageDirectory: database.storageDirectory,
      storageFilePath: "/var/lib/ctlflow/identityd.sqlite",
      environment: baseEnvironment,
      files: files.deployment,
      provision: async () => {
        await replaceVerificationKeys(
          provisionDatabase.connection,
          {
            keys: [options.signing.verificationKey],
            expiresAt: new Date(
              Date.now() + 5 * 60_000).toISOString()
          });
      }
    });
    return createService(
      options,
      publication.stop,
      database,
      service,
      auditSource,
      files.certificateAuthorityPath,
      files.serverName,
      baseEnvironment);
  } catch (error) {
    await service?.stop().catch(() => undefined);
    await auditSource?.stop().catch(() => undefined);
    await database?.stop().catch(() => undefined);
    await publication.stop().catch(() => undefined);
    throw error;
  }
}

function createEnvironment(
  options: StartIdentitydProductionServiceOptions,
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
    CTLFLOW_WORKLOAD_TOKEN_FILE:
      "/var/run/secrets/ctlflow/token",
    CTLFLOW_AUDIT_URL: options.auditd.endpoint,
    CTLFLOW_AUDIT_TLS_SERVER_NAME: options.auditd.serverName,
    CTLFLOW_AUDIT_TLS_CA_PATH:
      "/var/run/ctlflow/trust/auditd-ca.crt",
    CTLFLOW_AUDIT_CALL_TIMEOUT_MILLISECONDS: "500",
    CTLFLOW_DATABASE_PROVIDER: "sqlite",
    CTLFLOW_DATABASE_PATH: "/var/lib/ctlflow/identityd.sqlite",
    CTLFLOW_DATABASE_POOL_SIZE: "8",
    CTLFLOW_WORKLOAD_TOKEN_ISSUER: workloadIssuer,
    CTLFLOW_WORKLOAD_TOKEN_AUDIENCE: workloadAudience,
    CTLFLOW_WORKLOAD_JWKS_PATH:
      "/var/run/ctlflow/trust/workload-jwks.json",
    CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "600",
    CTLFLOW_INVOCATION_TOKEN_ISSUER: options.invocationIssuer,
    CTLFLOW_INVOCATION_TOKEN_AUDIENCE: options.invocationAudience,
    CTLFLOW_INVOCATION_TOKEN_MAX_LIFETIME_SECONDS:
      String(options.invocationMaximumLifetimeSeconds),
    CTLFLOW_INVOCATION_KEY_CACHE_SECONDS: "30",
    CTLFLOW_INVOCATION_SIGNING_KEY_ID:
      options.signing.verificationKey.keyId,
    CTLFLOW_INVOCATION_SIGNING_PRIVATE_KEY_PATH:
      "/var/run/ctlflow/tls/invocation-signing.pem",
    CTLFLOW_SESSION_LIFETIME_SECONDS: "43200",
    CTLFLOW_GET_INVOCATION_VERIFICATION_KEYS_CALLERS:
      options.verificationKeyCallers.join(","),
    CTLFLOW_RESOLVE_PRINCIPAL_CALLERS:
      options.principalFactCallers.join(","),
    CTLFLOW_LIST_PRINCIPAL_GROUPS_CALLERS:
      options.principalFactCallers.join(","),
    CTLFLOW_CREATE_SESSION_CALLERS:
      caller(options, "authd"),
    CTLFLOW_EXCHANGE_SESSION_CALLERS:
      caller(options, "edged"),
    CTLFLOW_REVOKE_SESSION_CALLERS:
      caller(options, "authd"),
    CTLFLOW_ISSUE_RUN_INVOCATION_CALLERS:
      caller(options, "execd"),
    OTEL_EXPORTER_OTLP_ENDPOINT: options.telemetryEndpoint
  };
}

function caller(
  options: StartIdentitydProductionServiceOptions,
  service: string
): string {
  return `system:serviceaccount:${options.kubernetes.namespace}:${service}`;
}

function createService(
  options: StartIdentitydProductionServiceOptions,
  stopPublication: () => Promise<void>,
  database: IdentityTestDatabase,
  service: CSharpService,
  auditSource: AuditdTestSource,
  certificateAuthorityPath: string,
  serverName: string,
  baseEnvironment: Readonly<Record<string, string>>
): IdentitydProductionService {
  const modes = new Map<string, IdentitydMode>();
  let stopped = false;
  return {
    endpoint:
      `https://${serviceName}.${options.kubernetes.namespace}.svc:50051`,
    certificateAuthorityPath,
    serverName,
    createSource: async (configuration) => {
      modes.set(configuration.callerSubject, "available");
      await replaceVerificationKeys(
        database.connection,
        configuration.verificationKeys);
      await replacePrincipalFacts(
        database.connection,
        configuration.principalFacts);
      if (configuration.externalIdentityLinks !== undefined) {
        await replaceExternalIdentityLinks(
          database.connection,
          configuration.externalIdentityLinks);
      }
      return {
        setMode: async (mode) => {
          modes.set(configuration.callerSubject, mode);
          await applyModes(
            options,
            service,
            baseEnvironment,
            modes);
        },
        setVerificationKeys: async (response) => {
          await replaceVerificationKeys(database.connection, response);
        },
        setPrincipalFacts: async (facts) => {
          await replacePrincipalFacts(database.connection, facts);
        },
        stop: async () => {
          modes.delete(configuration.callerSubject);
        }
      };
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

async function applyModes(
  options: StartIdentitydProductionServiceOptions,
  service: CSharpService,
  baseEnvironment: Readonly<Record<string, string>>,
  modes: ReadonlyMap<string, IdentitydMode>
): Promise<void> {
  const unavailable = [...modes.values()]
    .some((mode) => mode === "unavailable");
  if (unavailable) {
    await scaleIdentityd(options, 0);
    return;
  }

  await scaleIdentityd(options, 1);
  const denied = new Set(
    [...modes.entries()]
      .filter(([, mode]) => mode === "denied")
      .map(([caller]) => caller));
  await service.restart({
    ...baseEnvironment,
    CTLFLOW_GET_INVOCATION_VERIFICATION_KEYS_CALLERS:
      options.verificationKeyCallers
        .filter((caller) => !denied.has(caller))
        .join(","),
    CTLFLOW_RESOLVE_PRINCIPAL_CALLERS:
      options.principalFactCallers
        .filter((caller) => !denied.has(caller))
        .join(","),
    CTLFLOW_LIST_PRINCIPAL_GROUPS_CALLERS:
      options.principalFactCallers
        .filter((caller) => !denied.has(caller))
        .join(",")
  });
}

async function scaleIdentityd(
  options: StartIdentitydProductionServiceOptions,
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
  database: IdentityTestDatabase,
  auditSource: AuditdTestSource,
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

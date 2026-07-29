import {
  randomBytes
} from "node:crypto";
import {
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  credentials,
  type ClientOptions
} from "@grpc/grpc-js";
import type {
  CSharpService
} from "@ctlflow/test-mesh";
import type {
  AuditdProductionSource
} from "@ctlflow/auditd/testing/production";
import type {
  IdentitydProductionSource
} from "@ctlflow/identityd/testing/production";
import {
  ConfigurationServiceClient
} from "../../generated/v1/configd.js";
import type {
  ExecdTestSuite
} from "../../suite/execd-test-suite.js";
import {
  createOperatorChannel
} from "../create-operator-channel.js";
import {
  createTestDatabase
} from "../create-test-database.js";
import {
  prepareServiceFiles
} from "../prepare-service-files.js";
import type {
  TestDatabase
} from "../test-database.js";
import type {
  ConfigdTestService
} from "./configd-test-service.js";

const serviceName = "configd";

export async function startConfigdTestService(
  suite: ExecdTestSuite,
  execdCallerSubject: string,
  provisionerCallerSubject: string
): Promise<ConfigdTestService> {
  const database = await createTestDatabase(
    suite.kubernetes.storage,
    serviceName);
  const workload =
    await suite.kubernetes.createWorkloadCredentials(serviceName);
  const serviceSubject = subject(suite, serviceName);
  const auditd = await suite.auditd.createSource(serviceSubject);
  const identityd = await suite.identityd.createSource({
    callerSubject: serviceSubject,
    verificationKeys: {
      keys: [suite.invocation.verificationKey],
      expiresAt: new Date(
        Date.now() + 4 * 60_000).toISOString()
    },
    principalFacts: []
  });
  let process: CSharpService | undefined;
  let client: ConfigurationServiceClient | undefined;
  let workloadClient: ConfigurationServiceClient | undefined;

  try {
    const keyRing = path.join(
      database.directory,
      "encryption-key-ring-source.json");
    await writeFile(
      keyRing,
      JSON.stringify({
        active_key_id: "config_primary",
        keys: [{
          key_id: "config_primary",
          key_base64: randomBytes(32).toString("base64")
        }]
      }),
      { mode: 0o600 });
    const files = await prepareServiceFiles({
      repositoryRoot: suite.repositoryRoot,
      directory: database.directory,
      serviceName,
      workload,
      kubernetes: suite.kubernetes,
      trust: [
        {
          name: "kubernetes-api-ca.crt",
          path: suite.kubernetes.api.certificateAuthorityPath
        },
        {
          name: "auditd-ca.crt",
          path: suite.auditd.certificateAuthorityPath
        },
        {
          name: "identityd-ca.crt",
          path: suite.identityd.certificateAuthorityPath
        },
        {
          name: "policyd-ca.crt",
          path: suite.policyd.certificateAuthorityPath
        }
      ],
      secrets: [{
        name: "encryption-key-ring.json",
        path: keyRing
      }]
    });
    process = await suite.runtimes.configd.start({
      kubernetes: suite.kubernetes,
      name: serviceName,
      storageDirectory: database.storageDirectory,
      environment: createEnvironment(
        suite,
        database.containerPath,
        workload.issuer,
        workload.audience,
        execdCallerSubject,
        provisionerCallerSubject),
      files: files.deployment
    });
    const channel = await createOperatorChannel(
      suite.kubernetes,
      files.certificateAuthorityPath,
      files.serverName);
    client = new ConfigurationServiceClient(
      `127.0.0.1:${String(process.grpcPort)}`,
      channel.credentials,
      channel.options);
    workloadClient = new ConfigurationServiceClient(
      `127.0.0.1:${String(process.grpcPort)}`,
      credentials.createSsl(await readFile(
        files.certificateAuthorityPath)),
      clientOptions(files.serverName));

    let stopped = false;
    return {
      endpoint:
        `https://${serviceName}.${suite.kubernetes.namespace}.svc:50051`,
      serverName: files.serverName,
      certificateAuthorityPath: files.certificateAuthorityPath,
      client,
      workloadClient,
      process,
      database,
      auditd,
      identityd,
      stop: async () => {
        if (stopped) {
          return;
        }
        stopped = true;
        client?.close();
        workloadClient?.close();
        await stopResources(process, database, auditd, identityd);
      }
    };
  } catch (error) {
    client?.close();
    workloadClient?.close();
    await stopResources(
      process,
      database,
      auditd,
      identityd).catch(() => undefined);
    throw error;
  }
}

function clientOptions(serverName: string): ClientOptions {
  return {
    "grpc.ssl_target_name_override": serverName,
    "grpc.default_authority": serverName
  };
}

function createEnvironment(
  suite: ExecdTestSuite,
  databasePath: string,
  workloadIssuer: string,
  workloadAudience: string,
  execdCallerSubject: string,
  provisionerCallerSubject: string
): Readonly<Record<string, string>> {
  const capabilityCallerSubject = subject(suite, "product-backend");

  return {
    CTLFLOW_GRPC_URL: "https://0.0.0.0:50051",
    CTLFLOW_PROBE_URL: "http://0.0.0.0:8080",
    CTLFLOW_TLS_CERTIFICATE_PATH: "/var/run/ctlflow/tls/tls.crt",
    CTLFLOW_TLS_PRIVATE_KEY_PATH: "/var/run/ctlflow/tls/tls.key",
    CTLFLOW_KUBERNETES_CLIENT_CA_PATH:
      "/var/run/ctlflow/trust/kubernetes-client-ca.crt",
    CTLFLOW_KUBERNETES_API_URL:
      "https://kubernetes.default.svc:443",
    CTLFLOW_KUBERNETES_API_CA_PATH:
      "/var/run/ctlflow/trust/kubernetes-api-ca.crt",
    CTLFLOW_KUBERNETES_API_TOKEN_FILE:
      "/var/run/secrets/ctlflow/kubernetes-token",
    CTLFLOW_KUBERNETES_API_CALL_TIMEOUT_MILLISECONDS: "2000",
    CTLFLOW_DATABASE_PROVIDER: "sqlite",
    CTLFLOW_DATABASE_PATH: databasePath,
    CTLFLOW_DATABASE_POOL_SIZE: "8",
    CTLFLOW_CONFIGD_ENCRYPTION_KEY_RING_PATH:
      "/var/run/ctlflow/tls/encryption-key-ring.json",
    CTLFLOW_WORKLOAD_TOKEN_FILE: "/var/run/secrets/ctlflow/token",
    CTLFLOW_AUDIT_URL: suite.auditd.endpoint,
    CTLFLOW_AUDIT_TLS_SERVER_NAME: suite.auditd.serverName,
    CTLFLOW_AUDIT_TLS_CA_PATH:
      "/var/run/ctlflow/trust/auditd-ca.crt",
    CTLFLOW_AUDIT_CALL_TIMEOUT_MILLISECONDS: "1000",
    CTLFLOW_IDENTITY_URL: suite.identityd.endpoint,
    CTLFLOW_IDENTITY_TLS_SERVER_NAME: suite.identityd.serverName,
    CTLFLOW_IDENTITY_TLS_CA_PATH:
      "/var/run/ctlflow/trust/identityd-ca.crt",
    CTLFLOW_IDENTITY_CALL_TIMEOUT_MILLISECONDS: "2000",
    CTLFLOW_POLICY_URL: suite.policyd.endpoint,
    CTLFLOW_POLICY_TLS_SERVER_NAME: suite.policyd.serverName,
    CTLFLOW_POLICY_TLS_CA_PATH:
      "/var/run/ctlflow/trust/policyd-ca.crt",
    CTLFLOW_POLICY_CALL_TIMEOUT_MILLISECONDS: "2000",
    CTLFLOW_WORKLOAD_TOKEN_ISSUER: workloadIssuer,
    CTLFLOW_WORKLOAD_TOKEN_AUDIENCE: workloadAudience,
    CTLFLOW_WORKLOAD_JWKS_PATH:
      "/var/run/ctlflow/trust/workload-jwks.json",
    CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "600",
    CTLFLOW_INVOCATION_TOKEN_ISSUER: suite.invocation.issuer,
    CTLFLOW_INVOCATION_TOKEN_AUDIENCE: suite.invocation.audience,
    CTLFLOW_INVOCATION_TOKEN_MAX_LIFETIME_SECONDS: "60",
    CTLFLOW_OPERATOR_SUBJECTS: suite.kubernetes.api.clientSubject,
    CTLFLOW_PUBLISH_CONFIGURATION_PROVISIONER_CALLERS:
      provisionerCallerSubject,
    CTLFLOW_PUBLISH_CONFIGURATION_CAPABILITY_CALLERS:
      capabilityCallerSubject,
    CTLFLOW_RESOLVE_CONFIGURATION_CAPABILITY_CALLERS:
      capabilityCallerSubject,
    CTLFLOW_PUBLISH_SECRET_PROVISIONER_CALLERS:
      provisionerCallerSubject,
    CTLFLOW_PUBLISH_SECRET_CAPABILITY_CALLERS:
      capabilityCallerSubject,
    CTLFLOW_GET_SECRET_METADATA_CAPABILITY_CALLERS:
      capabilityCallerSubject,
    CTLFLOW_APPLY_PROJECTION_EXECD_CALLERS: execdCallerSubject,
    OTEL_EXPORTER_OTLP_ENDPOINT: suite.collector.endpoint
  };
}

function subject(
  suite: ExecdTestSuite,
  name: string
): string {
  return `system:serviceaccount:${suite.kubernetes.namespace}:${name}`;
}

async function stopResources(
  process: CSharpService | undefined,
  database: TestDatabase,
  auditd: AuditdProductionSource,
  identityd: IdentitydProductionSource
): Promise<void> {
  let failure: unknown;
  for (const stop of [
    process?.stop,
    identityd.stop,
    auditd.stop,
    database.stop
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

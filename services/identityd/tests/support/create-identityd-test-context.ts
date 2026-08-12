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
  AuditdProductionSource
} from "@ctlflow/auditd/testing/production";
import {
  startPolicydProductionService,
  type PolicydProductionService
} from "@ctlflow/policyd/testing/production";
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
  createIdentitydProductionAdapter
} from "./dependencies/create-identityd-production-adapter.js";
import {
  waitForPolicyReadiness
} from "./dependencies/wait-for-policy-readiness.js";
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
  readonly adminWorkload: TestWorkloadCredentials;
  readonly authdWorkload: TestWorkloadCredentials;
  readonly configdWorkload: TestWorkloadCredentials;
  readonly edgedWorkload: TestWorkloadCredentials;
  readonly execdWorkload: TestWorkloadCredentials;
  readonly pkgdWorkload: TestWorkloadCredentials;
  readonly policydWorkload: TestWorkloadCredentials;
  readonly tenantdWorkload: TestWorkloadCredentials;
  readonly auditd: AuditdProductionSource;
  readonly policyd: PolicydProductionService;
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
  let auditd: AuditdProductionSource | undefined;
  let policyd: PolicydProductionService | undefined;

  try {
    await suite.collector.resume();
    await suite.collector.clearExports();
    const adminWorkload =
      await suite.kubernetes.createWorkloadCredentials("admin-backend");
    const authdWorkload =
      await suite.kubernetes.createWorkloadCredentials("authd");
    const configdWorkload =
      await suite.kubernetes.createWorkloadCredentials("configd");
    const edgedWorkload =
      await suite.kubernetes.createWorkloadCredentials(
        "edged",
        "ctlflow-edged");
    const execdWorkload =
      await suite.kubernetes.createWorkloadCredentials("execd");
    const pkgdWorkload =
      await suite.kubernetes.createWorkloadCredentials("pkgd");
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
      suite.policydTls.certificateAuthorityPath,
      invocation);
    const environment = createEnvironment(
      suite.collector,
      database,
      suite.auditd.endpoint,
      suite.auditd.serverName,
      `https://policyd.${suite.kubernetes.namespace}.svc:50051`,
      suite.policydTls.serverName,
      invocation.verificationKey.keyId,
      adminWorkload,
      authdWorkload,
      execdWorkload,
      policydWorkload,
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
    const identityd = createIdentitydProductionAdapter({
      kubernetes: suite.kubernetes,
      database,
      service,
      environment,
      certificateAuthorityPath: files.serverCertificateAuthorityPath,
      serverName: files.serverName
    });
    policyd = await startPolicydProductionService({
      repositoryRoot: suite.repositoryRoot,
      kubernetes: suite.kubernetes,
      identityd,
      telemetryEndpoint: suite.collector.endpoint,
      invocationIssuer: invocation.issuer,
      invocationAudience: invocation.audience,
      invocationMaximumLifetimeSeconds: 60,
      verificationKeys: {
        keys: [{
          keyId: invocation.verificationKey.keyId,
          algorithm: "RS256",
          modulusBase64url:
            invocation.verificationKey.modulusBase64url,
          exponentBase64url:
            invocation.verificationKey.exponentBase64url
        }],
        expiresAt: new Date(Date.now() + 4 * 60_000).toISOString()
      },
      policy: { roles: [], grants: [] },
      tls: suite.policydTls
    });
    await service.restart();
    const endpoint = `127.0.0.1:${String(service.grpcPort)}`;
    const serverAuthority = await readFile(
      files.serverCertificateAuthorityPath);
    client = new IdentityServiceClient(
      endpoint,
      credentials.createSsl(serverAuthority),
      createClientOptions(files.serverName));
    await waitForPolicyReadiness(
      client,
      adminWorkload,
      invocation,
      false);

    let stopped = false;
    return {
      adminWorkload,
      authdWorkload,
      configdWorkload,
      edgedWorkload,
      execdWorkload,
      pkgdWorkload,
      policydWorkload,
      tenantdWorkload,
      auditd,
      policyd,
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
        await stopResources(service, database, auditd, policyd);
      }
    };
  } catch (error) {
    client?.close();
    await stopResources(service, database, auditd, policyd)
      .catch(() => undefined);
    throw error;
  }
}

function createEnvironment(
  collector: OpenTelemetryCollector,
  database: TestDatabase,
  auditEndpoint: string,
  auditServerName: string,
  policyEndpoint: string,
  policyServerName: string,
  signingKeyId: string,
  adminWorkload: TestWorkloadCredentials,
  authdWorkload: TestWorkloadCredentials,
  execdWorkload: TestWorkloadCredentials,
  policydWorkload: TestWorkloadCredentials,
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
    CTLFLOW_POLICY_URL: policyEndpoint,
    CTLFLOW_POLICY_TLS_SERVER_NAME: policyServerName,
    CTLFLOW_POLICY_TLS_CA_PATH:
      "/var/run/ctlflow/trust/policyd-ca.crt",
    CTLFLOW_POLICY_CALL_TIMEOUT_MILLISECONDS: "500",
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
    CTLFLOW_RESOLVE_PRINCIPAL_CALLERS:
      policydWorkload.callerSubject,
    CTLFLOW_LIST_PRINCIPAL_GROUPS_CALLERS:
      policydWorkload.callerSubject,
    CTLFLOW_CREATE_SESSION_CALLERS:
      authdWorkload.callerSubject,
    CTLFLOW_REVOKE_SESSION_CALLERS:
      authdWorkload.callerSubject,
    CTLFLOW_ISSUE_RUN_INVOCATION_CALLERS:
      execdWorkload.callerSubject,
    CTLFLOW_GET_LOGIN_PROVIDER_AUTHD_CALLERS:
      authdWorkload.callerSubject,
    CTLFLOW_GET_WORKSPACE_LOGIN_PROVIDER_ADMISSION_AUTHD_CALLERS:
      authdWorkload.callerSubject,
    CTLFLOW_ADD_TENANT_MEMBER_CALLERS: adminWorkload.callerSubject,
    CTLFLOW_REMOVE_TENANT_MEMBER_CALLERS: adminWorkload.callerSubject,
    CTLFLOW_LIST_TENANT_MEMBERS_CALLERS: adminWorkload.callerSubject,
    CTLFLOW_ADD_WORKSPACE_MEMBER_CALLERS: adminWorkload.callerSubject,
    CTLFLOW_REMOVE_WORKSPACE_MEMBER_CALLERS: adminWorkload.callerSubject,
    CTLFLOW_LIST_WORKSPACE_MEMBERS_CALLERS: adminWorkload.callerSubject,
    CTLFLOW_CREATE_GROUP_CALLERS: adminWorkload.callerSubject,
    CTLFLOW_DELETE_GROUP_CALLERS: adminWorkload.callerSubject,
    CTLFLOW_LIST_GROUPS_CALLERS: adminWorkload.callerSubject,
    CTLFLOW_ADD_GROUP_MEMBER_CALLERS: adminWorkload.callerSubject,
    CTLFLOW_REMOVE_GROUP_MEMBER_CALLERS: adminWorkload.callerSubject,
    CTLFLOW_LIST_GROUP_MEMBERS_CALLERS: adminWorkload.callerSubject,
    CTLFLOW_CREATE_VIRTUAL_PRINCIPAL_CALLERS:
      adminWorkload.callerSubject,
    CTLFLOW_GET_VIRTUAL_PRINCIPAL_CALLERS:
      adminWorkload.callerSubject,
    CTLFLOW_LIST_VIRTUAL_PRINCIPALS_CALLERS:
      adminWorkload.callerSubject,
    CTLFLOW_SET_VIRTUAL_PRINCIPAL_ENABLED_CALLERS:
      adminWorkload.callerSubject,
    CTLFLOW_CREATE_EXTERNAL_IDENTITY_LINK_CALLERS:
      adminWorkload.callerSubject,
    CTLFLOW_DELETE_EXTERNAL_IDENTITY_LINK_CALLERS:
      adminWorkload.callerSubject,
    CTLFLOW_LIST_EXTERNAL_IDENTITY_LINKS_CALLERS:
      adminWorkload.callerSubject,
    CTLFLOW_CREATE_LOGIN_PROVIDER_CALLERS:
      adminWorkload.callerSubject,
    CTLFLOW_GET_LOGIN_PROVIDER_CALLERS: adminWorkload.callerSubject,
    CTLFLOW_LIST_LOGIN_PROVIDERS_CALLERS: adminWorkload.callerSubject,
    CTLFLOW_UPDATE_LOGIN_PROVIDER_CALLERS: adminWorkload.callerSubject,
    CTLFLOW_SET_LOGIN_PROVIDER_STATE_CALLERS:
      adminWorkload.callerSubject,
    CTLFLOW_SET_WORKSPACE_LOGIN_PROVIDER_ADMISSION_CALLERS:
      adminWorkload.callerSubject,
    CTLFLOW_GET_WORKSPACE_LOGIN_PROVIDER_ADMISSION_CALLERS:
      adminWorkload.callerSubject,
    CTLFLOW_LIST_WORKSPACE_LOGIN_PROVIDER_ADMISSIONS_CALLERS:
      adminWorkload.callerSubject,
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
  auditd: AuditdProductionSource | undefined,
  policyd: PolicydProductionService | undefined
): Promise<void> {
  let failure: unknown;
  try {
    await policyd?.stop();
  } catch (error) {
    failure = error;
  }
  try {
    await service?.stop();
  } catch (error) {
    failure ??= error;
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

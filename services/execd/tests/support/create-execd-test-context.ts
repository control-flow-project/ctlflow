import {
  credentials,
  type ClientOptions
} from "@grpc/grpc-js";
import {
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type {
  CSharpService
} from "@ctlflow/test-mesh";
import type {
  AuditdProductionSource
} from "@ctlflow/auditd/testing/production";
import type {
  IdentitydProductionSource,
  PrincipalAuthorizationFacts
} from "@ctlflow/identityd/testing/production";
import {
  ExecutionServiceClient
} from "../generated/v1/execd.js";
import {
  createCapabilityGrants
} from "./authorization/create-capability-grants.js";
import {
  getExecdTestSuite
} from "../suite/get-execd-test-suite.js";
import {
  createOperatorChannel
} from "./create-operator-channel.js";
import {
  createTestDatabase
} from "./create-test-database.js";
import {
  startConfigdTestService
} from "./dependencies/start-configd-test-service.js";
import type {
  ConfigdTestService
} from "./dependencies/configd-test-service.js";
import type {
  PkgdTestService
} from "./dependencies/pkgd-test-service.js";
import {
  startPkgdTestService
} from "./dependencies/start-pkgd-test-service.js";
import type {
  ExecdTestContext
} from "./execd-test-context.js";
import {
  prepareServiceFiles
} from "./prepare-service-files.js";
import type {
  TestDatabase
} from "./test-database.js";
const serviceName = "execd";

export async function createExecdTestContext():
Promise<ExecdTestContext> {
  const suite = getExecdTestSuite();
  const execdWorkload =
    await suite.kubernetes.createWorkloadCredentials(serviceName);
  const capabilityWorkload =
    await suite.kubernetes.createWorkloadCredentials("product-backend");
  const provisionerWorkload =
    await suite.kubernetes.createWorkloadCredentials(
      "dependency-provisioner");
  const database = await createTestDatabase(
    suite.kubernetes.storage,
    serviceName);
  let pkgd: PkgdTestService | undefined;
  let configd: ConfigdTestService | undefined;
  let auditd: AuditdProductionSource | undefined;
  let identityd: IdentitydProductionSource | undefined;
  let process: CSharpService | undefined;
  const clients: ExecutionServiceClient[] = [];

  try {
    pkgd = await startPkgdTestService(
      suite,
      execdWorkload.callerSubject);
    configd = await startConfigdTestService(
      suite,
      execdWorkload.callerSubject,
      provisionerWorkload.callerSubject);
    const serviceSubject = subject(suite, serviceName);
    auditd = await suite.auditd.createSource(serviceSubject);
    const principalFacts = createPrincipalFacts();
    await suite.policyd.setPrincipalFacts(principalFacts);
    identityd = await suite.identityd.createSource({
      callerSubject: serviceSubject,
      verificationKeys: {
        keys: [suite.invocation.verificationKey],
        expiresAt: new Date(
          Date.now() + 4 * 60_000).toISOString()
      },
      principalFacts,
      loginProviders: [{
        tenantId: "tenant-a",
        providerId: "oidc",
        displayName: "Tenant A workforce",
        configurationId: "tenant-a-oidc",
        configurationVersionId: "tenant-a-oidc-v1",
        secretId: "tenant-a-oidc-secret",
        secretVersionId: "tenant-a-oidc-secret-v1",
        state: "active",
        revision: 1
      }],
      workspaceLoginProviderAdmissions: [{
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        providerId: "oidc"
      }],
      externalIdentityLinks: [{
        externalLinkId: "eil_00000000000000000000000000000001",
        tenantId: "tenant-a",
        providerId: "oidc",
        providerSubject: "alice@example.com",
        accountId: "user:alice",
        revision: 1
      }]
    });
    await suite.policyd.replacePolicy({
      roles: [],
      grants: createCapabilityGrants()
    });
    const provisioners = path.join(
      database.directory,
      "provisioner-subjects-source.json");
    await writeFile(
      provisioners,
      JSON.stringify({
        "test-provisioner": provisionerWorkload.callerSubject
      }),
      { mode: 0o600 });
    const files = await prepareServiceFiles({
      repositoryRoot: suite.repositoryRoot,
      directory: database.directory,
      serviceName,
      workload: execdWorkload,
      kubernetes: suite.kubernetes,
      // The suite-level TLS identity that policyd already trusts.
      tls: suite.execdTls,
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
        },
        {
          name: "pkgd-ca.crt",
          path: pkgd.certificateAuthorityPath
        },
        {
          name: "configd-ca.crt",
          path: configd.certificateAuthorityPath
        },
        {
          name: "provisioner-subjects.json",
          path: provisioners
        }
      ]
    });
    const environment = createEnvironment(
      suite,
      database.containerPath,
      execdWorkload,
      capabilityWorkload.callerSubject,
      pkgd,
      configd);
    process = await suite.runtimes.execd.start({
      kubernetes: suite.kubernetes,
      name: serviceName,
      storageDirectory: database.storageDirectory,
      environment,
      files: files.deployment
    });
    const channel = await createOperatorChannel(
      suite.kubernetes,
      files.certificateAuthorityPath,
      files.serverName);
    const endpoint = `127.0.0.1:${String(process.grpcPort)}`;
    const client = new ExecutionServiceClient(
      endpoint,
      channel.credentials,
      channel.options);
    const capabilityClient = new ExecutionServiceClient(
      endpoint,
      credentials.createSsl(await readFile(
        files.certificateAuthorityPath)),
      clientOptions(files.serverName));
    const unadmitted =
      await suite.kubernetes.createOperatorCredentials(
        "unadmitted-operator");
    const unadmittedChannel = credentials.createSsl(
      await readFile(files.certificateAuthorityPath),
      await readFile(unadmitted.privateKeyPath),
      await readFile(unadmitted.certificatePath));
    const unadmittedOperatorClient = new ExecutionServiceClient(
      endpoint,
      unadmittedChannel,
      clientOptions(files.serverName));
    clients.push(
      client,
      capabilityClient,
      unadmittedOperatorClient);

    let stopped = false;
    return {
      execdWorkload,
      capabilityWorkload,
      provisionerWorkload,
      pkgd,
      configd,
      process,
      database,
      auditd,
      identityd,
      client,
      capabilityClient,
      unadmittedOperatorClient,
      operatorSubject: suite.kubernetes.api.clientSubject,
      grpcPort: process.grpcPort,
      probePort: process.probePort,
      environment,
      stop: async () => {
        if (stopped) {
          return;
        }
        stopped = true;
        for (const current of clients) {
          current.close();
        }
        await stopResources(
          process,
          database,
          auditd,
          identityd,
          configd,
          pkgd);
      }
    };
  } catch (error) {
    for (const client of clients) {
      client.close();
    }
    await stopResources(
      process,
      database,
      auditd,
      identityd,
      configd,
      pkgd).catch(() => undefined);
    throw error;
  }
}

function createEnvironment(
  suite: ReturnType<typeof getExecdTestSuite>,
  databasePath: string,
  workload: ExecdTestContext["execdWorkload"],
  capabilityCaller: string,
  pkgd: ExecdTestContext["pkgd"],
  configd: ExecdTestContext["configd"]
): Readonly<Record<string, string>> {
  return {
    CTLFLOW_GRPC_URL: "https://0.0.0.0:50051",
    CTLFLOW_PROBE_URL: "http://0.0.0.0:8080",
    CTLFLOW_TLS_CERTIFICATE_PATH: "/var/run/ctlflow/tls/tls.crt",
    CTLFLOW_TLS_PRIVATE_KEY_PATH: "/var/run/ctlflow/tls/tls.key",
    CTLFLOW_KUBERNETES_CLIENT_CA_PATH:
      "/var/run/ctlflow/trust/kubernetes-client-ca.crt",
    CTLFLOW_DATABASE_PROVIDER: "sqlite",
    CTLFLOW_DATABASE_PATH: databasePath,
    CTLFLOW_DATABASE_POOL_SIZE: "8",
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
    CTLFLOW_PACKAGE_URL: pkgd.endpoint,
    CTLFLOW_PACKAGE_TLS_SERVER_NAME: pkgd.serverName,
    CTLFLOW_PACKAGE_TLS_CA_PATH:
      "/var/run/ctlflow/trust/pkgd-ca.crt",
    CTLFLOW_PACKAGE_CALL_TIMEOUT_MILLISECONDS: "2000",
    CTLFLOW_CONFIGURATION_URL: configd.endpoint,
    CTLFLOW_CONFIGURATION_TLS_SERVER_NAME: configd.serverName,
    CTLFLOW_CONFIGURATION_TLS_CA_PATH:
      "/var/run/ctlflow/trust/configd-ca.crt",
    CTLFLOW_CONFIGURATION_CALL_TIMEOUT_MILLISECONDS: "2000",
    CTLFLOW_KUBERNETES_API_URL:
      "https://kubernetes.default.svc:443",
    CTLFLOW_KUBERNETES_API_CA_PATH:
      "/var/run/ctlflow/trust/kubernetes-api-ca.crt",
    CTLFLOW_KUBERNETES_API_TOKEN_FILE:
      "/var/run/secrets/ctlflow/kubernetes-token",
    CTLFLOW_KUBERNETES_API_CALL_TIMEOUT_MILLISECONDS: "3000",
    CTLFLOW_RECONCILE_INTERVAL_MILLISECONDS: "100",
    CTLFLOW_EDGED_IMAGE: suite.edgedImage,
    CTLFLOW_PROVISIONER_SUBJECTS_PATH:
      "/var/run/ctlflow/trust/provisioner-subjects.json",
    CTLFLOW_WORKLOAD_TOKEN_ISSUER: workload.issuer,
    CTLFLOW_WORKLOAD_TOKEN_AUDIENCE: workload.audience,
    CTLFLOW_WORKLOAD_JWKS_PATH:
      "/var/run/ctlflow/trust/workload-jwks.json",
    CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "600",
    CTLFLOW_INVOCATION_TOKEN_ISSUER: suite.invocation.issuer,
    CTLFLOW_INVOCATION_TOKEN_AUDIENCE: suite.invocation.audience,
    CTLFLOW_INVOCATION_TOKEN_MAX_LIFETIME_SECONDS: "60",
    CTLFLOW_OPERATOR_SUBJECTS: suite.kubernetes.api.clientSubject,
    CTLFLOW_CAPABILITY_CALLERS: capabilityCaller,
    CTLFLOW_POLICYD_CALLER:
      `system:serviceaccount:${suite.kubernetes.namespace}:policyd`,
    OTEL_EXPORTER_OTLP_ENDPOINT: suite.collector.endpoint
  };
}

function createPrincipalFacts():
readonly PrincipalAuthorizationFacts[] {
  return [
    {
      principalId: "user:alice",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      principalKind: "human",
      principalEnabled: true,
      principalRevision: 1,
      subjectAccountId: "user:alice",
      subjectAccountEnabled: true,
      subjectAccountRevision: 1,
      membershipRevision: 1,
      groupIds: []
    },
    {
      principalId: "agent:reviewer",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      principalKind: "virtual",
      principalEnabled: true,
      principalRevision: 1,
      subjectAccountId: "user:alice",
      subjectAccountEnabled: true,
      subjectAccountRevision: 1,
      membershipRevision: 1,
      groupIds: []
    },
    {
      principalId: "service:automation",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      principalKind: "service",
      principalEnabled: true,
      principalRevision: 2,
      subjectAccountId: "service:automation",
      subjectAccountEnabled: true,
      subjectAccountRevision: 2,
      membershipRevision: 2,
      groupIds: []
    }
  ];
}

function clientOptions(serverName: string): ClientOptions {
  return {
    "grpc.ssl_target_name_override": serverName,
    "grpc.default_authority": serverName
  };
}

function subject(
  suite: ReturnType<typeof getExecdTestSuite>,
  name: string
): string {
  return `system:serviceaccount:${suite.kubernetes.namespace}:${name}`;
}

async function stopResources(
  process: CSharpService | undefined,
  database: TestDatabase,
  auditd: AuditdProductionSource | undefined,
  identityd: IdentitydProductionSource | undefined,
  configd: ExecdTestContext["configd"] | undefined,
  pkgd: ExecdTestContext["pkgd"] | undefined
): Promise<void> {
  let failure: unknown;
  for (const stop of [
    process?.stop,
    identityd?.stop,
    auditd?.stop,
    configd?.stop,
    pkgd?.stop,
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

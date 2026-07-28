import {
  credentials,
  type ClientOptions
} from "@grpc/grpc-js";
import {
  readFile
} from "node:fs/promises";
import type {
  OpenTelemetryCollector,
  TestKubernetes,
  TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import type {
  AuditdProductionSource
} from "@ctlflow/auditd/testing/production";
import type {
  IdentitydProductionSource
} from "@ctlflow/identityd/testing/production";
import type {
  PolicydProductionService
} from "@ctlflow/policyd/testing/production";
import {
  ConfigurationServiceClient
} from "../generated/v1/configd.js";
import type {
  ConfigdRunningService
} from "../runtime/configd-test-runtime.js";
import {
  getConfigdTestSuite
} from "../suite/get-configd-test-suite.js";
import {
  createConfigdEnvironment,
  type ConfigdCallers
} from "./create-configd-environment.js";
import {
  createTestDatabase
} from "./create-test-database.js";
import type {
  InvocationAuthority
} from "./invocation-authority.js";
import {
  prepareConfigdContextFiles
} from "./prepare-configd-context-files.js";
import type {
  TestDatabase
} from "./test-database.js";

const serviceName = "configd";

export interface ConfigdTestContext {
  readonly unadmittedWorkload: TestWorkloadCredentials;
  readonly capabilityWorkload: TestWorkloadCredentials;
  readonly readOnlyCapabilityWorkload: TestWorkloadCredentials;
  readonly provisionerWorkload: TestWorkloadCredentials;
  readonly execdWorkload: TestWorkloadCredentials;
  readonly collector: OpenTelemetryCollector;
  readonly kubernetes: TestKubernetes;
  readonly invocation: InvocationAuthority;
  readonly auditd: AuditdProductionSource;
  readonly identityd: IdentitydProductionSource;
  readonly policyd: PolicydProductionService;
  readonly reconnectPolicyIdentity: () => Promise<void>;
  readonly database: TestDatabase;
  readonly service: ConfigdRunningService;
  readonly client: ConfigurationServiceClient;
  readonly workloadClient: ConfigurationServiceClient;
  readonly unadmittedOperatorClient: ConfigurationServiceClient;
  readonly operatorSubject: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly grpcPort: number;
  readonly probePort: number;
  readonly stop: () => Promise<void>;
}

export async function createConfigdTestContext():
Promise<ConfigdTestContext> {
  const suite = getConfigdTestSuite();
  let database: TestDatabase | undefined;
  let auditd: AuditdProductionSource | undefined;
  let identityd: IdentitydProductionSource | undefined;
  let service: ConfigdRunningService | undefined;
  const clients: ConfigurationServiceClient[] = [];

  try {
    await suite.collector.resume();
    await suite.collector.clearExports();
    const unadmittedWorkload =
      await suite.kubernetes.createWorkloadCredentials(
        "unadmitted-backend");
    const capabilityWorkload =
      await suite.kubernetes.createWorkloadCredentials(
        "product-backend");
    const readOnlyCapabilityWorkload =
      await suite.kubernetes.createWorkloadCredentials(
        "reader-backend");
    const provisionerWorkload =
      await suite.kubernetes.createWorkloadCredentials(
        "dependency-provisioner");
    const execdWorkload =
      await suite.kubernetes.createWorkloadCredentials("execd");
    const callers: ConfigdCallers = {
      capability: capabilityWorkload,
      readOnlyCapability: readOnlyCapabilityWorkload,
      provisioner: provisionerWorkload,
      execd: execdWorkload
    };
    database = await createTestDatabase(
      suite.kubernetes.storage);
    const serviceAccountSubject =
      `system:serviceaccount:${suite.kubernetes.namespace}:`
      + serviceName;
    auditd = await suite.auditd.createSource(
      serviceAccountSubject);
    identityd = await suite.identityd.createSource({
      callerSubject: serviceAccountSubject,
      verificationKeys: {
        keys: [suite.invocation.verificationKey],
        expiresAt: new Date(
          Date.now() + 4 * 60_000).toISOString()
      },
      principalFacts: []
    });
    const files = await prepareConfigdContextFiles({
      repositoryRoot: suite.repositoryRoot,
      directory: database.directory,
      serviceName,
      workload: execdWorkload,
      kubernetes: suite.kubernetes,
      auditd: suite.auditd,
      identityd: suite.identityd,
      policyd: suite.policyd
    });
    const environment = createConfigdEnvironment(
      suite.collector,
      suite.auditd.endpoint,
      suite.identityd.endpoint,
      suite.policyd.endpoint,
      database,
      callers,
      suite.invocation,
      files,
      suite.auditd.serverName,
      suite.identityd.serverName,
      suite.policyd.serverName,
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
    const client = new ConfigurationServiceClient(
      endpoint,
      credentials.createSsl(
        serverAuthority,
        await readFile(
          suite.kubernetes.api.clientKeyPath),
        await readFile(
          suite.kubernetes.api.clientCertificatePath)),
      options);
    const workloadClient = new ConfigurationServiceClient(
      endpoint,
      credentials.createSsl(serverAuthority),
      options);
    const unadmittedOperatorClient =
      new ConfigurationServiceClient(
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
      unadmittedWorkload,
      capabilityWorkload,
      readOnlyCapabilityWorkload,
      provisionerWorkload,
      execdWorkload,
      collector: suite.collector,
      kubernetes: suite.kubernetes,
      invocation: suite.invocation,
      auditd,
      identityd,
      policyd: suite.policyd,
      reconnectPolicyIdentity:
        suite.policyd.reconnectIdentity,
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

function createClientOptions(serverName: string): ClientOptions {
  return {
    "grpc.ssl_target_name_override": serverName,
    "grpc.default_authority": serverName
  };
}

async function stopResources(
  service: ConfigdRunningService | undefined,
  database: TestDatabase | undefined,
  auditd: AuditdProductionSource | undefined,
  identityd: IdentitydProductionSource | undefined
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

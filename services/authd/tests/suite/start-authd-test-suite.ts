import {
  startAuditdProductionService,
  type AuditdProductionService
} from "@ctlflow/auditd/testing/production";
import {
  startControlledOidcProvider,
  type ControlledOidcProvider
} from "@ctlflow/authd/testing/provider";
import {
  startEgressdProductionService,
  type EgressdProductionService
} from "@ctlflow/egressd/testing/production";
import {
  startIdentitydProductionService,
  type IdentitydProductionService,
  type IdentitydProductionSource
} from "@ctlflow/identityd/testing/production";
import {
  startOpenTelemetryCollector,
  startTestKubernetes,
  type CSharpStatelessService,
  type OpenTelemetryCollector,
  type TestKubernetes
} from "@ctlflow/test-mesh";
import {
  loadAuthdTestRuntime
} from "../runtime/load-authd-test-runtime.js";
import type {
  AuthdTestRuntime
} from "../runtime/authd-test-runtime.js";
import {
  createInvocationSigning
} from "../support/create-invocation-signing.js";
import {
  prepareAuthdEgressFiles
} from "../support/prepare-authd-egress-files.js";
import {
  prepareAuthdFiles,
  type PreparedAuthdFiles
} from "../support/prepare-authd-files.js";
import {
  repositoryRoot
} from "../support/test-paths.js";
import type {
  AuthdTestSuite
} from "./authd-test-suite.js";

export async function startAuthdTestSuite():
Promise<AuthdTestSuite> {
  let runtime: AuthdTestRuntime | undefined;
  let kubernetes: TestKubernetes | undefined;
  let collector: OpenTelemetryCollector | undefined;
  let auditd: AuditdProductionService | undefined;
  let identityd: IdentitydProductionService | undefined;
  let identitySource: IdentitydProductionSource | undefined;
  let provider: ControlledOidcProvider | undefined;
  let egressd: EgressdProductionService | undefined;
  let authd: CSharpStatelessService | undefined;
  let files: PreparedAuthdFiles | undefined;
  try {
    runtime = await loadAuthdTestRuntime();
    kubernetes = await startTestKubernetes(repositoryRoot);
    collector = await startOpenTelemetryCollector(
      repositoryRoot,
      kubernetes);
    auditd = await startAuditdProductionService({
      repositoryRoot,
      kubernetes,
      telemetryEndpoint: collector.endpoint
    });
    const signing = createInvocationSigning();
    const policydSubject =
      `system:serviceaccount:${kubernetes.namespace}:policyd`;
    identityd = await startIdentitydProductionService({
      repositoryRoot,
      kubernetes,
      auditd,
      signing,
      telemetryEndpoint: collector.endpoint,
      invocationIssuer: "https://identityd.test",
      invocationAudience: "ctlflow-internal",
      invocationMaximumLifetimeSeconds: 60,
      verificationKeyCallers: [policydSubject],
      principalFactCallers: [policydSubject]
    });
    identitySource = await identityd.createSource({
      callerSubject:
        `system:serviceaccount:${kubernetes.namespace}:authd`,
      verificationKeys: {
        keys: [signing.verificationKey],
        expiresAt: new Date(Date.now() + 300_000).toISOString()
      },
      principalFacts: [{
        principalId: "user:alice",
        tenantId: "acme",
        principalKind: "human",
        principalEnabled: true,
        principalRevision: 1,
        subjectAccountId: "user:alice",
        subjectAccountEnabled: true,
        subjectAccountRevision: 1,
        membershipRevision: 1,
        groupIds: []
      }],
      externalIdentityLinks: [{
        tenantId: "acme",
        providerId: "oidc",
        providerSubject: "alice@example.com",
        accountId: "user:alice",
        revision: 1
      }]
    });
    provider = await startControlledOidcProvider({
      repositoryRoot,
      kubernetes,
      callbackUri:
        "https://auth.example.test/auth/v1/callback"
    });
    const authdWorkload =
      await kubernetes.createWorkloadCredentials("authd");
    const unadmittedWorkload =
      await kubernetes.createWorkloadCredentials(
        "authd-unadmitted");
    const egressFiles = await prepareAuthdEgressFiles(
      kubernetes,
      authdWorkload,
      provider);
    egressd = await startEgressdProductionService({
      repositoryRoot,
      kubernetes,
      workload: authdWorkload,
      files: egressFiles,
      telemetryEndpoint: collector.endpoint
    });
    files = await prepareAuthdFiles(
      kubernetes,
      provider,
      egressd.bindingName,
      identityd.certificateAuthorityPath,
      unadmittedWorkload.callerToken);
    authd = await runtime.start({
      kubernetes,
      environment: {
        CTLFLOW_IDENTITY_URL: identityd.endpoint,
        CTLFLOW_IDENTITY_TLS_SERVER_NAME: identityd.serverName,
        OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint
      },
      files: files.deployment
    });
    let stopped = false;
    return {
      repositoryRoot,
      runtime,
      kubernetes,
      collector,
      auditd,
      identityd,
      identitySource,
      provider,
      egressd,
      authd,
      files,
      stop: async () => {
        if (stopped) {
          return;
        }
        stopped = true;
        await stopResources(
          authd,
          egressd,
          provider,
          identitySource,
          identityd,
          auditd,
          collector,
          kubernetes,
          runtime);
      }
    };
  } catch (error) {
    await stopResources(
      authd,
      egressd,
      provider,
      identitySource,
      identityd,
      auditd,
      collector,
      kubernetes,
      runtime).catch(() => undefined);
    throw error;
  }
}

async function stopResources(
  ...resources: readonly (
    | { readonly stop: () => Promise<void> }
    | undefined
  )[]
): Promise<void> {
  let failure: unknown;
  for (const resource of resources) {
    try {
      await resource?.stop();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) {
    throw failure;
  }
}

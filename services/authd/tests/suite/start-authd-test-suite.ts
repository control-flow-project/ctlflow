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
  startPolicydProductionService,
  type PolicydProductionService
} from "@ctlflow/policyd/testing/production";
import {
  startTenantdProductionService,
  type TenantdProductionService
} from "@ctlflow/tenantd/testing/production";
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
  providerRegistrationFixture
} from "../support/provider-registration-fixture.js";
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
  let policyd: PolicydProductionService | undefined;
  let tenantd: TenantdProductionService | undefined;
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
    const authdWorkload =
      await kubernetes.createWorkloadCredentials("authd");
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
      principalFactCallers: [policydSubject]
    });
    policyd = await startPolicydProductionService({
      repositoryRoot,
      kubernetes,
      identityd,
      telemetryEndpoint: collector.endpoint,
      invocationIssuer: "https://identityd.test",
      invocationAudience: "ctlflow-internal",
      invocationMaximumLifetimeSeconds: 60,
      verificationKeys: {
        keys: [signing.verificationKey],
        expiresAt: new Date(Date.now() + 300_000).toISOString()
      },
      principalFacts: [],
      policy: { roles: [], grants: [] }
    });
    tenantd = await startTenantdProductionService({
      repositoryRoot,
      kubernetes,
      auditd,
      identityd,
      policyd,
      telemetryEndpoint: collector.endpoint,
      invocationIssuer: "https://identityd.test",
      invocationAudience: "ctlflow-internal",
      invocationMaximumLifetimeSeconds: 60,
      retainedRecordCallers: [authdWorkload.callerSubject],
      addressResolutionCallers: [
        `system:serviceaccount:${kubernetes.namespace}:tenantd-resolver`
      ]
    });
    await tenantd.replaceTenancy({
      tenants: [{
        tenantId: "acme",
        address: "acme",
        displayName: "Acme",
        state: "active",
        revision: 1
      }],
      workspaces: [{
        workspaceId: "atlas",
        tenantId: "acme",
        address: "atlas",
        displayName: "Atlas",
        state: "active",
        revision: 1
      }]
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
      loginProviders: [{
        ...providerRegistrationFixture,
        displayName: "Acme workforce",
        state: "active",
        revision: 1
      }],
      workspaceLoginProviderAdmissions: [{
        tenantId: "acme",
        workspaceId: "atlas",
        providerId: "oidc"
      }],
      externalIdentityLinks: [{
        externalLinkId: "eil_00000000000000000000000000000001",
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
      tenantd.certificateAuthorityPath,
      unadmittedWorkload.callerToken);
    authd = await runtime.start({
      kubernetes,
      environment: {
        CTLFLOW_IDENTITY_URL: identityd.endpoint,
        CTLFLOW_IDENTITY_TLS_SERVER_NAME: identityd.serverName,
        CTLFLOW_TENANT_URL: tenantd.endpoint,
        CTLFLOW_TENANT_TLS_SERVER_NAME: tenantd.serverName,
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
      policyd,
      tenantd,
      authdWorkload,
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
          tenantd,
          policyd,
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
      tenantd,
      policyd,
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

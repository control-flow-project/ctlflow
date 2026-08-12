import path from "node:path";
import {
  startAuditdProductionService,
  type AuditdProductionService
} from "@ctlflow/auditd/testing/production";
import {
  startIdentitydProductionService,
  type IdentitydProductionService,
  type IdentitydProductionSource
} from "@ctlflow/identityd/testing/production";
import {
  buildNodeTestImage,
  startOpenTelemetryCollector,
  startTestKubernetes,
  type CSharpStatelessService,
  type OpenTelemetryCollector,
  type TestKubernetes,
  type TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import type {
  IdentityServiceClient
} from "../generated/v1/identityd.js";
import type {
  EdgedTestRuntime
} from "../runtime/edged-test-runtime.js";
import {
  loadEdgedTestRuntime
} from "../runtime/load-edged-test-runtime.js";
import {
  createIdentityClient
} from "../support/create-identity-client.js";
import {
  createInvocationSigning
} from "../support/create-invocation-signing.js";
import {
  createSession
} from "../support/create-session.js";
import {
  applicationContainerfilePath,
  repositoryRoot,
  serviceRoot
} from "../support/test-paths.js";
import type {
  EdgedTestSuite
} from "./edged-test-suite.js";

export async function startEdgedTestSuite():
Promise<EdgedTestSuite> {
  let runtime: EdgedTestRuntime | undefined;
  let kubernetes: TestKubernetes | undefined;
  let collector: OpenTelemetryCollector | undefined;
  let auditd: AuditdProductionService | undefined;
  let identityd: IdentitydProductionService | undefined;
  let identitySource: IdentitydProductionSource | undefined;
  let identityClient: IdentityServiceClient | undefined;
  let edged: CSharpStatelessService | undefined;
  try {
    runtime = await loadEdgedTestRuntime();
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
      principalFactCallers: [policydSubject]
    });
    identitySource = await identityd.createSource({
      callerSubject:
        `system:serviceaccount:${kubernetes.namespace}:edged`,
      verificationKeys: {
        keys: [signing.verificationKey],
        expiresAt: new Date(Date.now() + 300_000).toISOString()
      },
      principalFacts: [{
        principalId: "user:alice",
        tenantId: "acme",
        workspaceId: "atlas",
        principalKind: "human",
        principalEnabled: true,
        principalRevision: 1,
        subjectAccountId: "user:alice",
        subjectAccountEnabled: true,
        subjectAccountRevision: 1,
        membershipRevision: 1,
        groupIds: []
      }, {
        principalId: "user:bob",
        tenantId: "acme",
        workspaceId: "other",
        principalKind: "human",
        principalEnabled: true,
        principalRevision: 1,
        subjectAccountId: "user:bob",
        subjectAccountEnabled: true,
        subjectAccountRevision: 1,
        membershipRevision: 1,
        groupIds: []
      }],
      loginProviders: [{
        tenantId: "acme",
        providerId: "oidc",
        displayName: "Acme workforce",
        configurationId: "acme-oidc",
        configurationVersionId: "acme-oidc-v1",
        secretId: "acme-oidc-secret",
        secretVersionId: "acme-oidc-secret-v1",
        state: "active",
        revision: 1
      }],
      workspaceLoginProviderAdmissions: [{
        tenantId: "acme",
        workspaceId: "atlas",
        providerId: "oidc"
      }, {
        tenantId: "acme",
        workspaceId: "other",
        providerId: "oidc"
      }],
      externalIdentityLinks: [{
        externalLinkId: "eil_00000000000000000000000000000001",
        tenantId: "acme",
        providerId: "oidc",
        providerSubject: "alice@example.com",
        accountId: "user:alice",
        revision: 1
      }, {
        externalLinkId: "eil_00000000000000000000000000000002",
        tenantId: "acme",
        providerId: "oidc",
        providerSubject: "bob@example.com",
        accountId: "user:bob",
        revision: 1
      }]
    });
    const authdWorkload =
      await kubernetes.createWorkloadCredentials("authd");
    identityClient = await createIdentityClient(identityd);
    const applicationImage = await buildNodeTestImage({
      repositoryRoot,
      kubernetes,
      imageName: "edged-application",
      containerfilePath: applicationContainerfilePath,
      sourcePaths: [
        path.join(serviceRoot, "testing/application/node")
      ]
    });
    edged = await runtime.start({
      kubernetes,
      applicationImage,
      environment: createEnvironment(identityd, collector),
      files: {
        config: {},
        secret: {},
        trust: {
          "identityd-ca.crt":
            identityd.certificateAuthorityPath
        }
      }
    });
    return createSuite(
      runtime,
      kubernetes,
      collector,
      auditd,
      identityd,
      identitySource,
      identityClient,
      authdWorkload,
      edged);
  } catch (error) {
    identityClient?.close();
    await stopResources(
      edged,
      identitySource,
      identityd,
      auditd,
      collector,
      kubernetes,
      runtime).catch(() => undefined);
    throw error;
  }
}

function createEnvironment(
  identityd: IdentitydProductionService,
  collector: OpenTelemetryCollector
): Readonly<Record<string, string>> {
  return {
    CTLFLOW_EDGED_BINDING: JSON.stringify({
      schema_version: 1,
      target: {
        tenant_id: "acme",
        workspace_id: "atlas"
      },
      upstream_port: 18_080
    }),
    CTLFLOW_IDENTITY_URL: identityd.endpoint,
    CTLFLOW_IDENTITY_TLS_SERVER_NAME: identityd.serverName,
    CTLFLOW_IDENTITY_CALL_TIMEOUT_MILLISECONDS: "500",
    CTLFLOW_APPLICATION_TIMEOUT_MILLISECONDS: "2000",
    OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint
  };
}

function createSuite(
  runtime: EdgedTestRuntime,
  kubernetes: TestKubernetes,
  collector: OpenTelemetryCollector,
  auditd: AuditdProductionService,
  identityd: IdentitydProductionService,
  identitySource: IdentitydProductionSource,
  identityClient: IdentityServiceClient,
  authdWorkload: TestWorkloadCredentials,
  edged: CSharpStatelessService
): EdgedTestSuite {
  let stopped = false;
  return {
    repositoryRoot,
    runtime,
    kubernetes,
    collector,
    auditd,
    identityd,
    identitySource,
    identityClient,
    authdWorkload,
    edged,
    session: async (providerSubject) =>
      await createSession(
        identityClient,
        authdWorkload,
        providerSubject),
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      identityClient.close();
      await stopResources(
        edged,
        identitySource,
        identityd,
        auditd,
        collector,
        kubernetes,
        runtime);
    }
  };
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

import path from "node:path";
import {
  buildCSharpServiceImage,
  buildNodeTestImage,
  createTestServiceTls,
  publishContainerizedCSharpService,
  startOpenTelemetryCollector,
  startTestKubernetes,
  type CSharpServicePublication,
  type OpenTelemetryCollector,
  type TestKubernetes
} from "@ctlflow/test-mesh";
import {
  startAuditdProductionService,
  type AuditdProductionService
} from "@ctlflow/auditd/testing/production";
import {
  startIdentitydProductionService,
  type IdentitydProductionService
} from "@ctlflow/identityd/testing/production";
import {
  startPolicydProductionService,
  type PolicydProductionService
} from "@ctlflow/policyd/testing/production";
import {
  loadExecdTestRuntimes
} from "../runtime/load-execd-test-runtimes.js";
import type {
  ExecdTestRuntimes
} from "../runtime/service-test-runtime.js";
import {
  createInvocationAuthority
} from "../support/create-invocation-authority.js";
import {
  createIdentityClient
} from "../support/create-identity-client.js";
import {
  invocationAudience,
  invocationIssuer,
  invocationMaximumLifetimeSeconds
} from "../support/invocation-settings.js";
import {
  applicationContainerfilePath,
  edgedContainerfilePath,
  edgedDiagnosticsManifestPath,
  edgedProjectPath,
  repositoryRoot,
  serviceRoot
} from "../support/test-paths.js";
import type {
  IdentityServiceClient
} from "../generated/v1/identityd.js";
import type {
  ExecdTestSuite
} from "./execd-test-suite.js";
import {
  cleanupExecdKubernetesResources
} from "./cleanup-execd-kubernetes-resources.js";
import {
  installDependencyClaimCrd
} from "./install-dependency-claim-crd.js";

export async function startExecdTestSuite():
Promise<ExecdTestSuite> {
  let runtimes: ExecdTestRuntimes | undefined;
  let kubernetes: TestKubernetes | undefined;
  let collector: OpenTelemetryCollector | undefined;
  let auditd: AuditdProductionService | undefined;
  let identityd: IdentitydProductionService | undefined;
  let policyd: PolicydProductionService | undefined;
  let identityClient: IdentityServiceClient | undefined;
  let edgedPublication: CSharpServicePublication | undefined;

  try {
    const invocation = await createInvocationAuthority(
      "identity-primary-key");
    runtimes = await loadExecdTestRuntimes();
    kubernetes = await startTestKubernetes(repositoryRoot);
    await cleanupExecdKubernetesResources(kubernetes);
    await installDependencyClaimCrd(repositoryRoot, kubernetes);
    edgedPublication =
      await publishContainerizedCSharpService({
        repositoryRoot,
        projectPath: edgedProjectPath,
        diagnosticsManifestPath: edgedDiagnosticsManifestPath,
        containerfilePath: edgedContainerfilePath,
        executableName: "CtlFlow.Edge.Edged.Service"
      });
    const loadedEdgedImage = await buildCSharpServiceImage(
      repositoryRoot,
      "edged",
      edgedContainerfilePath,
      edgedPublication,
      kubernetes);
    const edgedArtifact =
      await kubernetes.resolveImageArtifact(loadedEdgedImage);
    const edgedImage =
      `${edgedArtifact.repository}@${edgedArtifact.manifestDigest}`;
    const applicationImage = await buildNodeTestImage({
      repositoryRoot,
      kubernetes,
      imageName: "execd-application",
      containerfilePath: applicationContainerfilePath,
      sourcePaths: [
        path.join(serviceRoot, "testing/application/node")
      ]
    });
    const applicationArtifact =
      await kubernetes.resolveImageArtifact(applicationImage);
    collector = await startOpenTelemetryCollector(
      repositoryRoot,
      kubernetes);
    auditd = await startAuditdProductionService({
      repositoryRoot,
      kubernetes,
      telemetryEndpoint: collector.endpoint
    });
    identityd = await startIdentitydProductionService({
      repositoryRoot,
      kubernetes,
      auditd,
      signing: invocation,
      telemetryEndpoint: collector.endpoint,
      invocationIssuer,
      invocationAudience,
      invocationMaximumLifetimeSeconds,
      principalFactCallers: [
        serviceSubject(kubernetes, "policyd")
      ]
    });
    const authdWorkload =
      await kubernetes.createWorkloadCredentials("authd");
    identityClient = await createIdentityClient(identityd);
    // One shared execd TLS identity, created before policyd so policyd can
    // trust the execd resolver endpoint from startup. Execd contexts reuse it.
    const execdTls = await createTestServiceTls(
      repositoryRoot,
      path.join(repositoryRoot, ".temp", "execd-shared-tls"),
      "execd",
      [
        "execd",
        `execd.${kubernetes.namespace}`,
        `execd.${kubernetes.namespace}.svc`
      ]);
    policyd = await startPolicydProductionService({
      repositoryRoot,
      kubernetes,
      identityd,
      telemetryEndpoint: collector.endpoint,
      invocationIssuer,
      invocationAudience,
      invocationMaximumLifetimeSeconds,
      verificationKeys: {
        keys: [invocation.verificationKey],
        expiresAt: new Date(
          Date.now() + 4 * 60_000).toISOString()
      },
      principalFacts: [],
      policy: {
        roles: [],
        grants: []
      },
      execution: {
        endpoint: `https://execd.${kubernetes.namespace}.svc:50051`,
        serverName: `execd.${kubernetes.namespace}.svc`,
        certificateAuthorityPath: execdTls.certificateAuthorityPath
      }
    });

    const activeIdentityClient = identityClient;
    let stopped = false;
    return {
      repositoryRoot,
      kubernetes,
      collector,
      auditd,
      identityd,
      identityClient: activeIdentityClient,
      authdWorkload,
      policyd,
      execdTls,
      edgedImage,
      applicationArtifact,
      invocation,
      runtimes,
      stop: async () => {
        if (stopped) {
          return;
        }
        stopped = true;
        activeIdentityClient.close();
        await stopResources(
          runtimes,
          kubernetes,
          collector,
          auditd,
          identityd,
          policyd,
          edgedPublication);
      }
    };
  } catch (error) {
    identityClient?.close();
    await stopResources(
      runtimes,
      kubernetes,
      collector,
      auditd,
      identityd,
      policyd,
      edgedPublication).catch(() => undefined);
    throw error;
  }
}

function serviceSubject(
  kubernetes: TestKubernetes,
  serviceName: string
): string {
  return `system:serviceaccount:${kubernetes.namespace}:${serviceName}`;
}

async function stopResources(
  runtimes: ExecdTestRuntimes | undefined,
  kubernetes: TestKubernetes | undefined,
  collector: OpenTelemetryCollector | undefined,
  auditd: AuditdProductionService | undefined,
  identityd: IdentitydProductionService | undefined,
  policyd: PolicydProductionService | undefined,
  edgedPublication: CSharpServicePublication | undefined
): Promise<void> {
  let failure: unknown;
  for (const stop of [
    policyd?.stop,
    identityd?.stop,
    auditd?.stop,
    collector?.stop,
    edgedPublication?.stop,
    kubernetes?.stop,
    runtimes?.stop
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

import {
  startControlledOrigin
} from "@ctlflow/egressd/testing/origin";
import {
  startOpenTelemetryCollector,
  startTestKubernetes,
  type CSharpStatelessService,
  type OpenTelemetryCollector,
  type TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  EgressdTestRuntime
} from "../runtime/egressd-test-runtime.js";
import {
  loadEgressdTestRuntime
} from "../runtime/load-egressd-test-runtime.js";
import {
  prepareEgressdFiles
} from "../support/prepare-egressd-files.js";
import {
  repositoryRoot
} from "../support/test-paths.js";
import type {
  EgressdTestSuite
} from "./egressd-test-suite.js";

const callerServiceAccount = "egress-consumer";

export async function startEgressdTestSuite():
Promise<EgressdTestSuite> {
  let runtime: EgressdTestRuntime | undefined;
  let kubernetes: TestKubernetes | undefined;
  let collector: OpenTelemetryCollector | undefined;
  let origin:
    Awaited<ReturnType<typeof startControlledOrigin>> | undefined;
  let egressd: CSharpStatelessService | undefined;
  try {
    runtime = await loadEgressdTestRuntime();
    kubernetes = await startTestKubernetes(repositoryRoot);
    collector = await startOpenTelemetryCollector(
      repositoryRoot,
      kubernetes);
    const caller = await kubernetes.createWorkloadCredentials(
      callerServiceAccount);
    origin = await startControlledOrigin(repositoryRoot, kubernetes);
    const files = await prepareEgressdFiles(
      repositoryRoot,
      kubernetes,
      caller,
      callerServiceAccount,
      origin);
    egressd = await runtime.start({
      kubernetes,
      environment: {
        CTLFLOW_WORKLOAD_TOKEN_ISSUER: caller.issuer,
        CTLFLOW_WORKLOAD_TOKEN_AUDIENCE: caller.audience,
        CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "600",
        CTLFLOW_UPSTREAM_TIMEOUT_MILLISECONDS: "2000",
        OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint
      },
      files: {
        config: { "binding.json": files.bindingPath },
        secret: { "secrets.json": files.secretsPath },
        trust: {
          "workload-jwks.json": files.workloadJwksPath,
          "upstream-ca.crt":
            files.upstreamCertificateAuthorityPath
        }
      }
    });
    let stopped = false;
    return {
      repositoryRoot,
      runtime,
      kubernetes,
      collector,
      caller,
      callerServiceAccount,
      origin,
      files,
      egressd,
      stop: async () => {
        if (stopped) {
          return;
        }
        stopped = true;
        await stopResources(
          egressd,
          origin,
          collector,
          kubernetes,
          runtime);
      }
    };
  } catch (error) {
    await stopResources(
      egressd,
      origin,
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

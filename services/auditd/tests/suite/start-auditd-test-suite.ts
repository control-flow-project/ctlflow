import {
  startOpenTelemetryCollector,
  startTestKubernetes,
  type OpenTelemetryCollector,
  type TestKubernetes
} from "@ctlflow/test-mesh";
import {
  loadAuditdTestRuntime
} from "../runtime/load-auditd-test-runtime.js";
import type {
  AuditdTestRuntime
} from "../runtime/auditd-test-runtime.js";
import {
  repositoryRoot
} from "../support/test-paths.js";
import type {
  AuditdTestSuite
} from "./auditd-test-suite.js";

export async function startAuditdTestSuite():
Promise<AuditdTestSuite> {
  let runtime: AuditdTestRuntime | undefined;
  let kubernetes: TestKubernetes | undefined;
  let collector: OpenTelemetryCollector | undefined;

  try {
    runtime = await loadAuditdTestRuntime();
    kubernetes = await startTestKubernetes(repositoryRoot);
    collector = await startOpenTelemetryCollector(
      repositoryRoot,
      kubernetes);
    let stopped = false;
    return {
      repositoryRoot,
      runtime,
      kubernetes,
      collector,
      stop: async () => {
        if (stopped) {
          return;
        }

        stopped = true;
        await stopResources(runtime, kubernetes, collector);
      }
    };
  } catch (error) {
    await stopResources(runtime, kubernetes, collector)
      .catch(() => undefined);
    throw error;
  }
}

async function stopResources(
  runtime: AuditdTestRuntime | undefined,
  kubernetes: TestKubernetes | undefined,
  collector: OpenTelemetryCollector | undefined
): Promise<void> {
  let failure: unknown;
  for (const stop of [
    collector?.stop,
    kubernetes?.stop,
    runtime?.stop
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

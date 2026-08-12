import path from "node:path";
import {
  createTestServiceTls,
  startOpenTelemetryCollector,
  startTestKubernetes,
  type OpenTelemetryCollector,
  type TestKubernetes,
  type TestServiceTls
} from "@ctlflow/test-mesh";
import {
  startAuditdProductionService,
  type AuditdProductionService
} from "@ctlflow/auditd/testing/production";
import {
  loadIdentitydTestRuntime
} from "../runtime/load-identityd-test-runtime.js";
import type {
  IdentitydTestRuntime
} from "../runtime/identityd-test-runtime.js";
import {
  repositoryRoot
} from "../support/test-paths.js";
import type {
  IdentitydTestSuite
} from "./identityd-test-suite.js";

export async function startIdentitydTestSuite():
Promise<IdentitydTestSuite> {
  let runtime: IdentitydTestRuntime | undefined;
  let kubernetes: TestKubernetes | undefined;
  let collector: OpenTelemetryCollector | undefined;
  let auditd: AuditdProductionService | undefined;
  let policydTls: TestServiceTls | undefined;

  try {
    runtime = await loadIdentitydTestRuntime();
    kubernetes = await startTestKubernetes(repositoryRoot);
    collector = await startOpenTelemetryCollector(
      repositoryRoot,
      kubernetes);
    auditd = await startAuditdProductionService({
      repositoryRoot,
      kubernetes,
      telemetryEndpoint: collector.endpoint
    });
    policydTls = await createTestServiceTls(
      repositoryRoot,
      path.join(repositoryRoot, ".temp", "identityd-policyd-tls"),
      "policyd",
      [
        "policyd",
        `policyd.${kubernetes.namespace}`,
        `policyd.${kubernetes.namespace}.svc`
      ]);
    let stopped = false;
    return {
      repositoryRoot,
      runtime,
      kubernetes,
      collector,
      auditd,
      policydTls,
      stop: async () => {
        if (stopped) {
          return;
        }

        stopped = true;
        await stopResources(runtime, kubernetes, collector, auditd);
      }
    };
  } catch (error) {
    await stopResources(runtime, kubernetes, collector, auditd)
      .catch(() => undefined);
    throw error;
  }
}

async function stopResources(
  runtime: IdentitydTestRuntime | undefined,
  kubernetes: TestKubernetes | undefined,
  collector: OpenTelemetryCollector | undefined,
  auditd: AuditdProductionService | undefined
): Promise<void> {
  let failure: unknown;
  for (const stop of [
    auditd?.stop,
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

import {
  startOpenTelemetryCollector,
  startTestKubernetes,
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
  createInvocationAuthority
} from "../support/create-invocation-authority.js";
import {
  invocationAudience,
  invocationIssuer,
  invocationMaximumLifetimeSeconds
} from "../support/invocation-settings.js";
import {
  repositoryRoot
} from "../support/test-paths.js";
import type {
  PolicydTestSuite
} from "./policyd-test-suite.js";

export async function startPolicydTestSuite():
Promise<PolicydTestSuite> {
  let kubernetes: TestKubernetes | undefined;
  let collector: OpenTelemetryCollector | undefined;
  let auditd: AuditdProductionService | undefined;
  let identityd: IdentitydProductionService | undefined;
  let policyd: PolicydProductionService | undefined;

  try {
    const invocation = await createInvocationAuthority(
      "policy-primary-key");
    kubernetes = await startTestKubernetes(repositoryRoot);
    collector = await startOpenTelemetryCollector(
      repositoryRoot,
      kubernetes);
    auditd = await startAuditdProductionService({
      repositoryRoot,
      kubernetes,
      telemetryEndpoint: collector.endpoint
    });
    const policydCaller =
      `system:serviceaccount:${kubernetes.namespace}:policyd`;
    identityd = await startIdentitydProductionService({
      repositoryRoot,
      kubernetes,
      auditd,
      signing: invocation,
      telemetryEndpoint: collector.endpoint,
      invocationIssuer,
      invocationAudience,
      invocationMaximumLifetimeSeconds,
      verificationKeyCallers: [policydCaller],
      principalFactCallers: [policydCaller]
    });
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
        expiresAt: new Date(Date.now() + 4 * 60_000).toISOString()
      },
      principalFacts: []
    });
    let stopped = false;
    return {
      repositoryRoot,
      kubernetes,
      collector,
      auditd,
      identityd,
      policyd,
      invocation,
      stop: async () => {
        if (stopped) {
          return;
        }
        stopped = true;
        await stopResources(
          policyd,
          identityd,
          auditd,
          collector,
          kubernetes);
      }
    };
  } catch (error) {
    await stopResources(
      policyd,
      identityd,
      auditd,
      collector,
      kubernetes).catch(() => undefined);
    throw error;
  }
}

async function stopResources(
  policyd: PolicydProductionService | undefined,
  identityd: IdentitydProductionService | undefined,
  auditd: AuditdProductionService | undefined,
  collector: OpenTelemetryCollector | undefined,
  kubernetes: TestKubernetes | undefined
): Promise<void> {
  let failure: unknown;
  for (const stop of [
    policyd?.stop,
    identityd?.stop,
    auditd?.stop,
    collector?.stop,
    kubernetes?.stop
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

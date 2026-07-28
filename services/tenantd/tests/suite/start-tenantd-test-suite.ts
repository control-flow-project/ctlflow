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
  loadTenantdTestRuntime
} from "../runtime/load-tenantd-test-runtime.js";
import type {
  TenantdTestRuntime
} from "../runtime/tenantd-test-runtime.js";
import {
  repositoryRoot
} from "../support/test-paths.js";
import {
  invocationAudience,
  invocationIssuer,
  invocationMaximumLifetimeSeconds
} from "../support/invocation-settings.js";
import type {
  TenantdTestSuite
} from "./tenantd-test-suite.js";
import {
  createInvocationAuthority
} from "../support/create-invocation-authority.js";

export async function startTenantdTestSuite():
Promise<TenantdTestSuite> {
  let runtime: TenantdTestRuntime | undefined;
  let kubernetes: TestKubernetes | undefined;
  let collector: OpenTelemetryCollector | undefined;
  let auditd: AuditdProductionService | undefined;
  let identityd: IdentitydProductionService | undefined;
  let policyd: PolicydProductionService | undefined;

  try {
    const invocation = await createInvocationAuthority(
      "identity-primary-key");
    runtime = await loadTenantdTestRuntime();
    kubernetes = await startTestKubernetes(repositoryRoot);
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
      verificationKeyCallers: [
        `system:serviceaccount:${kubernetes.namespace}:tenantd`,
        `system:serviceaccount:${kubernetes.namespace}:policyd`
      ],
      principalFactCallers: [
        `system:serviceaccount:${kubernetes.namespace}:policyd`
      ]
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
        expiresAt: new Date(
          Date.now() + 4 * 60_000).toISOString()
      },
      principalFacts: [],
      policy: {
        roles: [],
        grants: []
      }
    });
    let stopped = false;
    return {
      repositoryRoot,
      runtime,
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
          runtime,
          kubernetes,
          collector,
          auditd,
          identityd,
          policyd);
      }
    };
  } catch (error) {
    await stopResources(
      runtime,
      kubernetes,
      collector,
      auditd,
      identityd,
      policyd)
      .catch(() => undefined);
    throw error;
  }
}

async function stopResources(
  runtime: TenantdTestRuntime | undefined,
  kubernetes: TestKubernetes | undefined,
  collector: OpenTelemetryCollector | undefined,
  auditd: AuditdProductionService | undefined,
  identityd: IdentitydProductionService | undefined,
  policyd: PolicydProductionService | undefined
): Promise<void> {
  let failure: unknown;

  for (const stop of [
    policyd?.stop,
    identityd?.stop,
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

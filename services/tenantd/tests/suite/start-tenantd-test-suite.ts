import {
  startOpenTelemetryCollector,
  startTestKubernetes,
  type OpenTelemetryCollector,
  type TestKubernetes
} from "@ctlflow/test-mesh";
import {
  startAuditdContractService,
  type AuditdContractService
} from "@ctlflow/auditd/testing/stub";
import {
  startIdentitydContractService,
  type IdentitydContractService
} from "@ctlflow/identityd/testing/stub";
import {
  startPolicyContractService,
  type PolicyContractService
} from "@ctlflow/policyd/testing/stub";
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

export async function startTenantdTestSuite():
Promise<TenantdTestSuite> {
  let runtime: TenantdTestRuntime | undefined;
  let kubernetes: TestKubernetes | undefined;
  let collector: OpenTelemetryCollector | undefined;
  let auditd: AuditdContractService | undefined;
  let identityd: IdentitydContractService | undefined;
  let policyd: PolicyContractService | undefined;

  try {
    runtime = await loadTenantdTestRuntime();
    kubernetes = await startTestKubernetes(repositoryRoot);
    collector = await startOpenTelemetryCollector(
      repositoryRoot,
      kubernetes);
    auditd = await startAuditdContractService({
      repositoryRoot,
      kubernetes
    });
    identityd = await startIdentitydContractService({
      repositoryRoot,
      kubernetes
    });
    policyd = await startPolicyContractService({
      repositoryRoot,
      kubernetes,
      identityEndpoint: identityd.endpoint,
      identityServerName: identityd.serverName,
      identityCertificateAuthorityPath:
        identityd.certificateAuthorityPath,
      invocationIssuer,
      invocationAudience,
      invocationMaximumLifetimeSeconds
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
  auditd: AuditdContractService | undefined,
  identityd: IdentitydContractService | undefined,
  policyd: PolicyContractService | undefined
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

import {
  publishCSharpService,
  startOpenTelemetryCollector,
  startTestKubernetes,
  type CSharpServicePublication,
  type OpenTelemetryCollector,
  type TestKubernetes
} from "@ctlflow/test-mesh";
import {
  diagnosticsManifestPath,
  repositoryRoot,
  serviceProjectPath
} from "../support/test-paths.js";
import {
  serviceRoot
} from "../support/test-paths.js";
import {
  startAuditdContractService
} from "../dependencies/auditd/start-auditd-contract-service.js";
import type {
  AuditdContractService
} from "../dependencies/auditd/auditd-contract-service.js";
import type {
  TenantdTestSuite
} from "./tenantd-test-suite.js";

const executableName = "CtlFlow.Tenancy.Tenantd.Service";

export async function startTenantdTestSuite():
Promise<TenantdTestSuite> {
  let publication: CSharpServicePublication | undefined;
  let kubernetes: TestKubernetes | undefined;
  let collector: OpenTelemetryCollector | undefined;
  let auditd: AuditdContractService | undefined;

  try {
    publication = await publishCSharpService({
      repositoryRoot,
      projectPath: serviceProjectPath,
      diagnosticsManifestPath,
      executableName
    });
    kubernetes = await startTestKubernetes(repositoryRoot);
    collector = await startOpenTelemetryCollector(repositoryRoot);
    auditd = await startAuditdContractService(
      repositoryRoot,
      serviceRoot);
    let stopped = false;
    return {
      repositoryRoot,
      publication,
      kubernetes,
      collector,
      auditd,
      stop: async () => {
        if (stopped) {
          return;
        }

        stopped = true;
        await stopResources(
          publication,
          kubernetes,
          collector,
          auditd);
      }
    };
  } catch (error) {
    await stopResources(publication, kubernetes, collector, auditd)
      .catch(() => undefined);
    throw error;
  }
}

async function stopResources(
  publication: CSharpServicePublication | undefined,
  kubernetes: TestKubernetes | undefined,
  collector: OpenTelemetryCollector | undefined,
  auditd: AuditdContractService | undefined
): Promise<void> {
  let failure: unknown;

  for (const stop of [
    auditd?.stop,
    collector?.stop,
    kubernetes?.stop,
    publication?.stop
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

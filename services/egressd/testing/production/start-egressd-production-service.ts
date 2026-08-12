import path from "node:path";
import {
  publishContainerizedCSharpService,
  startCSharpStatelessService,
  type CSharpStatelessService
} from "@ctlflow/test-mesh";
import type {
  EgressdProductionService
} from "./egressd-production-service.js";
import type {
  StartEgressdProductionServiceOptions
} from "./start-egressd-production-service-options.js";

const serviceName = "egressd";
const executableName = "CtlFlow.Egress.Egressd.Service";

export async function startEgressdProductionService(
  options: StartEgressdProductionServiceOptions
): Promise<EgressdProductionService> {
  const serviceRoot = path.join(
    options.repositoryRoot,
    "services",
    serviceName);
  const csharpRoot = path.join(serviceRoot, "csharp");
  const publication = await publishContainerizedCSharpService({
    repositoryRoot: options.repositoryRoot,
    projectPath: path.join(
      csharpRoot,
      "src",
      executableName,
      `${executableName}.csproj`),
    diagnosticsManifestPath: path.join(
      csharpRoot,
      "nativeaot-diagnostics.json"),
    containerfilePath: path.join(csharpRoot, "Containerfile"),
    executableName
  });
  let service: CSharpStatelessService | undefined;
  try {
    const environment = {
      CTLFLOW_WORKLOAD_TOKEN_ISSUER: options.workload.issuer,
      CTLFLOW_WORKLOAD_TOKEN_AUDIENCE: options.workload.audience,
      CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "600",
      CTLFLOW_UPSTREAM_TIMEOUT_MILLISECONDS: "5000",
      OTEL_EXPORTER_OTLP_ENDPOINT: options.telemetryEndpoint
    };
    service = await startCSharpStatelessService({
      repositoryRoot: options.repositoryRoot,
      publication,
      kubernetes: options.kubernetes,
      name: serviceName,
      imageName: serviceName,
      containerfilePath: path.join(csharpRoot, "Containerfile"),
      kustomizeBasePath: path.join(
        serviceRoot,
        "kubernetes",
        "base"),
      environment,
      files: options.files
    });
    return createService(
      options,
      service,
      publication.stop,
      environment);
  } catch (error) {
    await service?.stop().catch(() => undefined);
    await publication.stop().catch(() => undefined);
    throw error;
  }
}

function createService(
  options: StartEgressdProductionServiceOptions,
  service: CSharpStatelessService,
  stopPublication: () => Promise<void>,
  environment: Readonly<Record<string, string>>
): EgressdProductionService {
  let suspended = false;
  let admission: "admitted" | "rejected" = "admitted";
  let stopped = false;
  return {
    bindingName: serviceName,
    endpoint:
      `http://${serviceName}.${options.kubernetes.namespace}.svc:8081`,
    diagnostics: service.diagnostics,
    setWorkloadAdmission: async (next) => {
      requireRunning(stopped);
      if (suspended) {
        throw new Error(
          "Egressd workload admission cannot change while suspended");
      }
      if (admission === next) {
        return;
      }
      await stopDeployment(options);
      await service.restart({
        ...environment,
        CTLFLOW_WORKLOAD_TOKEN_AUDIENCE:
          next === "admitted"
            ? options.workload.audience
            : "ctlflow-rejected-workload"
      });
      admission = next;
    },
    suspend: async () => {
      requireRunning(stopped);
      if (suspended) {
        return;
      }
      await stopDeployment(options);
      suspended = true;
    },
    resume: async () => {
      requireRunning(stopped);
      if (!suspended) {
        return;
      }
      await options.kubernetes.runKubectl([
        "scale",
        `deployment/${serviceName}`,
        "--namespace",
        options.kubernetes.namespace,
        "--replicas=1"
      ]);
      await options.kubernetes.runKubectl([
        "rollout",
        "status",
        `deployment/${serviceName}`,
        "--namespace",
        options.kubernetes.namespace,
        "--timeout=30s"
      ]);
      await waitForServiceEndpoint(options);
      await service.reconnect();
      suspended = false;
    },
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      await stopResources(service, stopPublication);
    }
  };
}

async function stopDeployment(
  options: StartEgressdProductionServiceOptions
): Promise<void> {
  await options.kubernetes.runKubectl([
    "scale",
    `deployment/${serviceName}`,
    "--namespace",
    options.kubernetes.namespace,
    "--replicas=0"
  ]);
  await options.kubernetes.runKubectl([
    "wait",
    "--for=delete",
    "pod",
    `--selector=app.kubernetes.io/name=${serviceName}`,
    "--namespace",
    options.kubernetes.namespace,
    "--timeout=30s"
  ]);
}

function requireRunning(stopped: boolean): void {
  if (stopped) {
    throw new Error("Egressd production service is stopped");
  }
}

async function waitForServiceEndpoint(
  options: StartEgressdProductionServiceOptions
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await options.kubernetes.runKubectl([
      "get",
      "endpointslices.discovery.k8s.io",
      `--selector=kubernetes.io/service-name=${serviceName}`,
      "--namespace",
      options.kubernetes.namespace,
      "--output=json"
    ]);
    const document = JSON.parse(result.stdout) as {
      readonly items?: readonly {
        readonly endpoints?: readonly {
          readonly addresses?: readonly string[];
          readonly conditions?: {
            readonly ready?: boolean;
          };
        }[];
      }[];
    };
    if (document.items?.some((item) =>
      item.endpoints?.some((endpoint) =>
        endpoint.conditions?.ready === true
        && (endpoint.addresses?.length ?? 0) > 0)) === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Egressd Service did not regain an endpoint");
}

async function stopResources(
  service: CSharpStatelessService,
  stopPublication: () => Promise<void>
): Promise<void> {
  let failure: unknown;
  for (const stop of [service.stop, stopPublication]) {
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

import {
  waitForKubernetesDeployment
} from "../../kubernetes/wait-for-kubernetes-deployment.js";
import {
  renderKustomizeService
} from "../../kubernetes/services/render-kustomize-service.js";
import {
  findAvailablePort
} from "../../ports/find-available-port.js";
import {
  waitForEndpoint
} from "../../ports/wait-for-endpoint.js";
import type {
  ManagedProcess
} from "../../processes/managed-process.js";
import {
  stopProcess
} from "../../processes/stop-process.js";
import {
  buildCSharpServiceImage
} from "./build-csharp-service-image.js";
import type {
  CSharpStatelessService,
  CSharpStatelessServiceOptions
} from "./csharp-stateless-service.js";
import {
  createStatelessServiceOverlay
} from "./create-stateless-service-overlay.js";

const publicContainerPort = 8081;
const probeContainerPort = 8080;

export async function startCSharpStatelessService(
  options: CSharpStatelessServiceOptions
): Promise<CSharpStatelessService> {
  validateName(options.name);
  const image = await buildCSharpServiceImage(
    options.repositoryRoot,
    options.imageName,
    options.containerfilePath,
    options.publication,
    options.kubernetes);
  const publicPort = await findAvailablePort();
  const probePort = await findAvailablePort();
  let environment = options.environment;
  let revision = 1;
  let publicForwarding: ManagedProcess | undefined;
  let probeForwarding: ManagedProcess | undefined;
  let logs: ManagedProcess | undefined;
  let stopped = false;

  try {
    await deploy();
    ({ publicForwarding, probeForwarding, logs } = await connect());
  } catch (error) {
    await stopProcesses(publicForwarding, probeForwarding, logs);
    await scaleToZero(options).catch(() => undefined);
    throw error;
  }

  return {
    executablePath: options.publication.executablePath,
    serviceAccountSubject:
      `system:serviceaccount:${options.kubernetes.namespace}:${options.name}`,
    publicPort,
    probePort,
    diagnostics: () => [
      logs?.diagnostics() ?? "",
      publicForwarding?.diagnostics() ?? "",
      probeForwarding?.diagnostics() ?? ""
    ].filter((value) => value.length > 0).join("\n"),
    reconnect: async () => {
      requireRunning();
      await stopProcesses(publicForwarding, probeForwarding, logs);
      ({ publicForwarding, probeForwarding, logs } = await connect());
    },
    restart: async (overrides = {}) => {
      requireRunning();
      await stopProcesses(publicForwarding, probeForwarding, logs);
      publicForwarding = undefined;
      probeForwarding = undefined;
      logs = undefined;
      environment = { ...environment, ...overrides };
      revision++;
      await deploy();
      ({ publicForwarding, probeForwarding, logs } = await connect());
    },
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      await stopProcesses(publicForwarding, probeForwarding, logs);
      await scaleToZero(options);
    }
  };

  async function deploy(): Promise<void> {
    const overlay = await createStatelessServiceOverlay(
      options,
      image,
      environment,
      revision);
    const manifest = await renderKustomizeService(
      options.kubernetes,
      overlay);
    await options.kubernetes.runKubectl(
      ["apply", "-f", "-"],
      manifest);
    await waitForKubernetesDeployment(
      options.kubernetes,
      options.name);
  }

  async function connect(): Promise<{
    readonly publicForwarding: ManagedProcess;
    readonly probeForwarding: ManagedProcess;
    readonly logs: ManagedProcess;
  }> {
    const nextPublic = options.kubernetes.startKubectl([
      "port-forward",
      `service/${options.name}`,
      "--namespace",
      options.kubernetes.namespace,
      "--address",
      "127.0.0.1",
      `${String(publicPort)}:${String(publicContainerPort)}`
    ]);
    const nextProbe = options.kubernetes.startKubectl([
      "port-forward",
      `service/${options.name}-probe`,
      "--namespace",
      options.kubernetes.namespace,
      "--address",
      "127.0.0.1",
      `${String(probePort)}:${String(probeContainerPort)}`
    ]);
    try {
      await Promise.all([
        waitForEndpoint("127.0.0.1", publicPort, 30_000),
        waitForEndpoint("127.0.0.1", probePort, 30_000)
      ]);
    } catch (error) {
      await stopProcess(nextPublic).catch(() => undefined);
      await stopProcess(nextProbe).catch(() => undefined);
      throw error;
    }
    const nextLogs = options.kubernetes.startKubectl([
      "logs",
      "--follow",
      `deployment/${options.name}`,
      "--namespace",
      options.kubernetes.namespace,
      "--all-containers=true"
    ]);
    return {
      publicForwarding: nextPublic,
      probeForwarding: nextProbe,
      logs: nextLogs
    };
  }

  function requireRunning(): void {
    if (stopped) {
      throw new Error("Cannot use a stopped stateless C# service");
    }
  }
}

async function stopProcesses(
  publicForwarding: ManagedProcess | undefined,
  probeForwarding: ManagedProcess | undefined,
  logs: ManagedProcess | undefined
): Promise<void> {
  for (const process of [publicForwarding, probeForwarding, logs]) {
    if (process !== undefined) {
      await stopProcess(process).catch(() => undefined);
    }
  }
}

async function scaleToZero(
  options: CSharpStatelessServiceOptions
): Promise<void> {
  await options.kubernetes.runKubectl([
    "scale",
    `deployment/${options.name}`,
    "--namespace",
    options.kubernetes.namespace,
    "--replicas=0"
  ]);
}

function validateName(name: string): void {
  if (!/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/u.test(name)) {
    throw new Error("Stateless C# service name is invalid");
  }
}

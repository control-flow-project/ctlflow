import path from "node:path";
import { findAvailablePort } from "../../ports/find-available-port.js";
import { waitForEndpoint } from "../../ports/wait-for-endpoint.js";
import {
  createKustomizeServiceOverlay
} from
  "../../kubernetes/services/create-kustomize-service-overlay.js";
import {
  grantKustomizeServiceStorageAccess
} from
  "../../kubernetes/services/grant-kustomize-service-storage-access.js";
import {
  type KustomizeServiceOptions
} from "../../kubernetes/services/kustomize-service.js";
import {
  renderKustomizeService
} from "../../kubernetes/services/render-kustomize-service.js";
import {
  resetKustomizeService
} from "../../kubernetes/services/reset-kustomize-service.js";
import {
  waitForKustomizeServiceMigration
} from
  "../../kubernetes/services/wait-for-kustomize-service-migration.js";
import {
  waitForKustomizeServiceRollout
} from
  "../../kubernetes/services/wait-for-kustomize-service-rollout.js";
import type { ManagedProcess } from "../../processes/managed-process.js";
import { stopProcess } from "../../processes/stop-process.js";
import { buildCSharpServiceImage } from
  "./build-csharp-service-image.js";
import type {
  CSharpService,
  CSharpServiceOptions
} from "./csharp-service.js";

const grpcContainerPort = 50051;
const probeContainerPort = 8080;

export async function startCSharpService(
  options: CSharpServiceOptions
): Promise<CSharpService> {
  validateName(options.name);
  validateStorageDirectory(options.storageDirectory);
  const image = await buildCSharpServiceImage(
    options.repositoryRoot,
    options.imageName,
    options.containerfilePath,
    options.publication,
    options.kubernetes);
  const serviceOptions: KustomizeServiceOptions = {
    repositoryRoot: options.repositoryRoot,
    kubernetes: options.kubernetes,
    name: options.name,
    kustomizeBasePath: options.kustomizeBasePath,
    image,
    migrationImage: options.migrationImage,
    storageDirectory: options.storageDirectory,
    storageFilePath: options.storageFilePath,
    environment: options.environment,
    files: options.files
  };
  const ports = await allocatePorts();
  let environment = options.environment;
  let revision = 1;
  let grpcForwarding: ManagedProcess | undefined;
  let probeForwarding: ManagedProcess | undefined;
  let logs: ManagedProcess | undefined;
  let disposed = false;

  try {
    await resetKustomizeService(serviceOptions);
    await deploy(environment, revision, true);
    ({ grpcForwarding, probeForwarding, logs } = await connect());
  } catch (error) {
    await stopProcesses(grpcForwarding, probeForwarding, logs);
    await scaleToZero(options).catch(() => undefined);
    throw error;
  }

  return {
    executablePath: options.publication.executablePath,
    serviceAccountSubject:
      `system:serviceaccount:${options.kubernetes.namespace}:${options.name}`,
    grpcPort: ports.grpc,
    probePort: ports.probe,
    diagnostics: () => [
      logs?.diagnostics() ?? "",
      grpcForwarding?.diagnostics() ?? "",
      probeForwarding?.diagnostics() ?? ""
    ].filter((value) => value.length > 0).join("\n"),
    reconnect: async () => {
      if (disposed) {
        throw new Error("Cannot reconnect a disposed C# service");
      }

      await stopProcesses(grpcForwarding, probeForwarding, logs);
      grpcForwarding = undefined;
      probeForwarding = undefined;
      logs = undefined;
      ({ grpcForwarding, probeForwarding, logs } = await connect());
    },
    restart: async (overrides = {}) => {
      if (disposed) {
        throw new Error("Cannot restart a disposed C# service");
      }

      await stopProcesses(grpcForwarding, probeForwarding, logs);
      grpcForwarding = undefined;
      probeForwarding = undefined;
      logs = undefined;
      environment = { ...environment, ...overrides };
      revision++;
      try {
        await deploy(environment, revision, false);
        ({ grpcForwarding, probeForwarding, logs } = await connect());
      } catch (error) {
        await scaleToZero(options).catch(() => undefined);
        throw error;
      }
    },
    stop: async () => {
      if (disposed) {
        return;
      }

      disposed = true;
      await stopProcesses(grpcForwarding, probeForwarding, logs);
      await scaleToZero(options);
    }
  };

  async function deploy(
    values: Readonly<Record<string, string>>,
    deploymentRevision: number,
    initial: boolean
  ): Promise<void> {
    const current = {
      ...serviceOptions,
      environment: values
    };
    const overlay = await createKustomizeServiceOverlay(
      current,
      deploymentRevision,
      initial ? 0 : 1);
    const manifest = await renderKustomizeService(
      options.kubernetes,
      overlay);
    await options.kubernetes.runKubectl(
      ["apply", "-f", "-"],
      manifest);
    if (initial) {
      await waitForKustomizeServiceMigration(current);
      await grantKustomizeServiceStorageAccess(current);
      await options.provision?.();
      await options.kubernetes.runKubectl([
        "scale",
        `statefulset/${options.name}`,
        "--namespace",
        options.kubernetes.namespace,
        "--replicas=1"
      ]);
    }
    await waitForKustomizeServiceRollout(current);
  }

  async function connect(): Promise<{
    readonly grpcForwarding: ManagedProcess;
    readonly probeForwarding: ManagedProcess;
    readonly logs: ManagedProcess;
  }> {
    const nextGrpcForwarding = options.kubernetes.startKubectl([
      "port-forward",
      `service/${options.name}`,
      "--namespace",
      options.kubernetes.namespace,
      "--address",
      "127.0.0.1",
      `${String(ports.grpc)}:${String(grpcContainerPort)}`
    ]);
    const nextProbeForwarding = options.kubernetes.startKubectl([
      "port-forward",
      `service/${options.name}-probe`,
      "--namespace",
      options.kubernetes.namespace,
      "--address",
      "127.0.0.1",
      `${String(ports.probe)}:${String(probeContainerPort)}`
    ]);
    try {
      await Promise.all([
        waitForEndpoint("127.0.0.1", ports.grpc, 30_000),
        waitForEndpoint("127.0.0.1", ports.probe, 30_000)
      ]);
    } catch (error) {
      await stopProcess(nextGrpcForwarding).catch(() => undefined);
      await stopProcess(nextProbeForwarding).catch(() => undefined);
      throw new Error(
        "C# service port-forward did not become ready\n"
        + nextGrpcForwarding.diagnostics()
        + "\n"
        + nextProbeForwarding.diagnostics(),
        { cause: error });
    }

    const nextLogs = options.kubernetes.startKubectl([
      "logs",
      "--follow",
      `statefulset/${options.name}`,
      "--namespace",
      options.kubernetes.namespace,
      "--all-containers=true"
    ]);
    return {
      grpcForwarding: nextGrpcForwarding,
      probeForwarding: nextProbeForwarding,
      logs: nextLogs
    };
  }
}

async function allocatePorts(): Promise<{
  readonly grpc: number;
  readonly probe: number;
}> {
  const values = new Set<number>();
  while (values.size < 2) {
    values.add(await findAvailablePort());
  }
  const [grpc, probe] = values;
  return {
    grpc: grpc!,
    probe: probe!
  };
}

async function stopProcesses(
  grpcForwarding: ManagedProcess | undefined,
  probeForwarding: ManagedProcess | undefined,
  logs: ManagedProcess | undefined
): Promise<void> {
  if (grpcForwarding !== undefined) {
    await stopProcess(grpcForwarding).catch(() => undefined);
  }
  if (probeForwarding !== undefined) {
    await stopProcess(probeForwarding).catch(() => undefined);
  }
  if (logs !== undefined) {
    await stopProcess(logs).catch(() => undefined);
  }
}

async function scaleToZero(
  options: CSharpServiceOptions
): Promise<void> {
  await options.kubernetes.runKubectl([
    "scale",
    `statefulset/${options.name}`,
    "--namespace",
    options.kubernetes.namespace,
    "--replicas=0"
  ]);
}

function validateName(name: string): void {
  if (!/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/u.test(name)) {
    throw new Error("C# service name is not a Kubernetes DNS label");
  }
}

function validateStorageDirectory(value: string): void {
  if (
    value.length === 0
    || path.isAbsolute(value)
    || value.split(/[\\/]/u).some(
      (segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error("C# service storage directory is invalid");
  }
}

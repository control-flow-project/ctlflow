import { setTimeout as delay } from "node:timers/promises";
import {
  findKubernetesPodFailure
} from "./find-kubernetes-pod-failure.js";
import type {
  TestKubernetes
} from "./test-kubernetes.js";

interface DeploymentDocument {
  readonly metadata?: {
    readonly generation?: number;
  };
  readonly status?: {
    readonly availableReplicas?: number;
    readonly observedGeneration?: number;
    readonly updatedReplicas?: number;
  };
}

export async function waitForKubernetesDeployment(
  kubernetes: TestKubernetes,
  name: string,
  timeoutMilliseconds = 30_000
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastState = "deployment not observed";

  while (Date.now() < deadline) {
    const deployment = JSON.parse((await kubernetes.runKubectl([
      "get",
      `deployment/${name}`,
      "--namespace",
      kubernetes.namespace,
      "--output=json"
    ])).stdout) as DeploymentDocument;
    const generation = deployment.metadata?.generation;
    const status = deployment.status;
    if (
      generation !== undefined
      && status?.observedGeneration === generation
      && status.availableReplicas === 1
      && status.updatedReplicas === 1
    ) {
      return;
    }

    const pods = JSON.parse((await kubernetes.runKubectl([
      "get",
      "pods",
      "--namespace",
      kubernetes.namespace,
      "--selector",
      `app.kubernetes.io/name=${name}`,
      "--output=json"
    ])).stdout);
    const failure = findKubernetesPodFailure(pods);
    if (failure !== undefined) {
      const diagnostics = await readDeploymentLogs(kubernetes, name);
      throw new Error(
        `Kubernetes deployment ${name} failed: ${failure}`
        + (diagnostics.length === 0 ? "" : `\n${diagnostics}`));
    }

    lastState = JSON.stringify(status ?? {});
    await delay(100);
  }

  throw new Error(
    `Kubernetes deployment ${name} did not become ready: ${lastState}`);
}

async function readDeploymentLogs(
  kubernetes: TestKubernetes,
  name: string
): Promise<string> {
  return await kubernetes.runKubectl([
    "logs",
    `deployment/${name}`,
    "--namespace",
    kubernetes.namespace,
    "--all-containers=true",
    "--prefix=true",
    "--tail=100"
  ]).then((result) => result.stdout.trim())
    .catch(() => "");
}

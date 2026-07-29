import { setTimeout as delay } from "node:timers/promises";
import {
  findKubernetesPodFailure
} from "./find-kubernetes-pod-failure.js";
import type {
  TestKubernetes
} from "./test-kubernetes.js";

interface StatefulSetDocument {
  readonly metadata?: {
    readonly generation?: number;
  };
  readonly spec?: {
    readonly replicas?: number;
  };
  readonly status?: {
    readonly currentReplicas?: number;
    readonly currentRevision?: string;
    readonly observedGeneration?: number;
    readonly readyReplicas?: number;
    readonly updatedReplicas?: number;
    readonly updateRevision?: string;
  };
}

export async function waitForKubernetesStatefulSet(
  kubernetes: TestKubernetes,
  name: string,
  timeoutMilliseconds = 60_000
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastState = "stateful set not observed";

  while (Date.now() < deadline) {
    const workload = JSON.parse((await kubernetes.runKubectl([
      "get",
      `statefulset/${name}`,
      "--namespace",
      kubernetes.namespace,
      "--output=json"
    ])).stdout) as StatefulSetDocument;
    const desired = workload.spec?.replicas ?? 0;
    const generation = workload.metadata?.generation;
    const currentRevision = workload.status?.currentRevision;
    const updateRevision = workload.status?.updateRevision;
    const state = workload.status;
    if (
      generation !== undefined
      && state?.observedGeneration === generation
      && state.currentReplicas === desired
      && state.readyReplicas === desired
      && state.updatedReplicas === desired
      && currentRevision !== undefined
      && currentRevision === updateRevision
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
      const diagnostics = await readDiagnostics(kubernetes, name);
      throw new Error(
        `Kubernetes stateful set ${name} failed: ${failure}`
        + (diagnostics.length === 0 ? "" : `\n${diagnostics}`));
    }

    lastState = JSON.stringify(state ?? {});
    await delay(100);
  }

  throw new Error(
    `Kubernetes stateful set ${name} did not become ready: ${lastState}`);
}

async function readDiagnostics(
  kubernetes: TestKubernetes,
  name: string
): Promise<string> {
  const values: string[] = [];
  for (const arguments_ of [
    [
      "logs",
      `statefulset/${name}`,
      "--namespace",
      kubernetes.namespace,
      "--all-containers=true",
      "--tail=200"
    ],
    [
      "describe",
      `statefulset/${name}`,
      "--namespace",
      kubernetes.namespace
    ]
  ]) {
    try {
      const result = await kubernetes.runKubectl(arguments_);
      const output = `${result.stdout}\n${result.stderr}`.trim();
      if (output.length > 0) {
        values.push(output);
      }
    } catch {
      // The original workload failure remains authoritative.
    }
  }
  return values.join("\n");
}

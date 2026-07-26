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
      throw new Error(
        `Kubernetes stateful set ${name} failed: ${failure}`);
    }

    lastState = JSON.stringify(state ?? {});
    await delay(100);
  }

  throw new Error(
    `Kubernetes stateful set ${name} did not become ready: ${lastState}`);
}

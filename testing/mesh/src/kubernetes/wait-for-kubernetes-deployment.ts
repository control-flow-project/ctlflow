import { setTimeout as delay } from "node:timers/promises";
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

interface PodListDocument {
  readonly items?: readonly {
    readonly metadata?: {
      readonly deletionTimestamp?: string;
      readonly name?: string;
    };
    readonly status?: {
      readonly containerStatuses?: readonly {
        readonly lastState?: {
          readonly terminated?: {
            readonly exitCode?: number;
            readonly reason?: string;
          };
        };
        readonly state?: {
          readonly terminated?: {
            readonly exitCode?: number;
            readonly reason?: string;
          };
          readonly waiting?: {
            readonly reason?: string;
          };
        };
      }[];
    };
  }[];
}

const terminalWaitingReasons = new Set([
  "CrashLoopBackOff",
  "CreateContainerConfigError",
  "CreateContainerError",
  "ErrImageNeverPull",
  "ImagePullBackOff",
  "InvalidImageName",
  "RunContainerError"
]);

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
    ])).stdout) as PodListDocument;
    const failure = findFailure(pods);
    if (failure !== undefined) {
      throw new Error(
        `Kubernetes deployment ${name} failed: ${failure}`);
    }

    lastState = JSON.stringify(status ?? {});
    await delay(100);
  }

  throw new Error(
    `Kubernetes deployment ${name} did not become ready: ${lastState}`);
}

function findFailure(
  pods: PodListDocument
): string | undefined {
  for (const pod of pods.items ?? []) {
    if (pod.metadata?.deletionTimestamp !== undefined) {
      continue;
    }
    for (const container of pod.status?.containerStatuses ?? []) {
      const terminated = container.state?.terminated;
      if ((terminated?.exitCode ?? 0) !== 0) {
        return describeFailure(
          pod.metadata?.name,
          terminated?.reason,
          terminated?.exitCode);
      }
      const waiting = container.state?.waiting?.reason;
      if (waiting !== undefined && terminalWaitingReasons.has(waiting)) {
        return describeFailure(
          pod.metadata?.name,
          waiting,
          container.lastState?.terminated?.exitCode);
      }
    }
  }

  return undefined;
}

function describeFailure(
  pod: string | undefined,
  reason: string | undefined,
  exitCode: number | undefined
): string {
  return [
    pod ?? "unknown pod",
    reason ?? "terminated",
    exitCode === undefined ? undefined : `exit ${String(exitCode)}`
  ].filter((value) => value !== undefined).join(", ");
}

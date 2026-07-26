interface KubernetesPodList {
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

export function findKubernetesPodFailure(
  pods: KubernetesPodList
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
      if (
        waiting !== undefined
        && terminalWaitingReasons.has(waiting)
      ) {
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
    exitCode === undefined
      ? undefined
      : `exit ${String(exitCode)}`
  ].filter((value) => value !== undefined).join(", ");
}

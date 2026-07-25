import { runKubectl } from "./run-kubectl.js";
import { runCommand } from "../processes/run-command.js";

export interface TestWorkloadDefinition {
  readonly podName: string;
  readonly serviceAccountName: string;
}

export async function createTestWorkloads(
  repositoryRoot: string,
  controlPlane: string,
  namespaceName: string,
  workloads: readonly TestWorkloadDefinition[]
): Promise<void> {
  const items: object[] = [
    {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: namespaceName }
    }
  ];
  for (const workload of workloads) {
    items.push(
      {
        apiVersion: "v1",
        kind: "ServiceAccount",
        metadata: {
          name: workload.serviceAccountName,
          namespace: namespaceName
        }
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata: {
          name: workload.podName,
          namespace: namespaceName
        },
        spec: {
          automountServiceAccountToken: true,
          containers: [
            {
              image: "registry.k8s.io/pause:3.10",
              name: "pause"
            }
          ],
          restartPolicy: "Never",
          serviceAccountName: workload.serviceAccountName
        }
      }
    );
  }

  await runCommand(
    "docker",
    [
      "exec",
      "-i",
      controlPlane,
      "kubectl",
      "--kubeconfig=/etc/kubernetes/admin.conf",
      "apply",
      "-f",
      "-"
    ],
    {
      cwd: repositoryRoot,
      input: JSON.stringify({
        apiVersion: "v1",
        kind: "List",
        items
      })
    });
  await runKubectl(
    repositoryRoot,
    controlPlane,
    [
      "wait",
      "pod",
      "--all",
      "--namespace",
      namespaceName,
      "--for=condition=Ready",
      "--timeout=90s"
    ]);
}

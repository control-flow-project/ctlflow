import { runKubectl } from "./run-kubectl.js";
import type { TestMinikube } from "./test-minikube.js";

export interface TestWorkloadDefinition {
  readonly podName: string;
  readonly serviceAccountName: string;
}

export async function createTestWorkloads(
  repositoryRoot: string,
  minikube: TestMinikube,
  namespaceName: string,
  workloads: readonly TestWorkloadDefinition[]
): Promise<void> {
  const bootstrapLabels = {
    "ctlflow.test/component": "credential-bootstrap"
  };
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
          namespace: namespaceName,
          labels: bootstrapLabels
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

  await runKubectl(
    repositoryRoot,
    minikube,
    ["apply", "-f", "-"],
    {
      input: JSON.stringify({
        apiVersion: "v1",
        kind: "List",
        items
      })
    });
  await runKubectl(
    repositoryRoot,
    minikube,
    [
      "wait",
      "pod",
      "--namespace",
      namespaceName,
      "--selector",
      "ctlflow.test/component=credential-bootstrap",
      "--for=condition=Ready",
      "--timeout=90s"
    ]);
}

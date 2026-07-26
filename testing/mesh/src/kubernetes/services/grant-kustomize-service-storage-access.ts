import type {
  KustomizeServiceOptions
} from "./kustomize-service.js";

export async function grantKustomizeServiceStorageAccess(
  options: KustomizeServiceOptions
): Promise<void> {
  const jobName = `${options.name}-test-storage-access`;
  await options.kubernetes.runKubectl(
    ["apply", "-f", "-"],
    JSON.stringify({
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: {
        name: jobName,
        namespace: options.kubernetes.namespace
      },
      spec: {
        backoffLimit: 1,
        template: {
          spec: {
            automountServiceAccountToken: false,
            restartPolicy: "Never",
            securityContext: {
              fsGroup: 65532,
              runAsNonRoot: true
            },
            containers: [{
              name: "grant-access",
              image: options.migrationImage,
              imagePullPolicy: "Never",
              command: [
                "chmod",
                "0666",
                options.storageFilePath
              ],
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
                readOnlyRootFilesystem: true,
                runAsGroup: 65532,
                runAsUser: 65532
              },
              volumeMounts: [{
                name: "data",
                mountPath: "/var/lib/ctlflow"
              }]
            }],
            volumes: [{
              name: "data",
              persistentVolumeClaim: {
                claimName: `${options.name}-data`
              }
            }]
          }
        }
      }
    }));
  await options.kubernetes.runKubectl([
    "wait",
    "--for=condition=complete",
    `job/${jobName}`,
    "--namespace",
    options.kubernetes.namespace,
    "--timeout=30s"
  ]);
}

import path from "node:path";
import {
  waitForKubernetesDeployment
} from "../../kubernetes/wait-for-kubernetes-deployment.js";
import {
  findAvailablePort
} from "../../ports/find-available-port.js";
import type {
  ManagedProcess
} from "../../processes/managed-process.js";
import {
  stopProcess
} from "../../processes/stop-process.js";
import {
  waitForEndpoint
} from "../../ports/wait-for-endpoint.js";
import type {
  NodeTestService,
  NodeTestServiceOptions
} from "./node-test-service.js";

const grpcPort = 50051;
const controlPort = 8080;

export async function startNodeTestService(
  options: NodeTestServiceOptions
): Promise<NodeTestService> {
  validateName(options.name);
  validateStorageDirectory(options.storageDirectory);
  const hostControlPort = await findAvailablePort();
  let forwarding: ManagedProcess | undefined;
  let logs: ManagedProcess | undefined;

  try {
    await options.kubernetes.runKubectl(
      ["apply", "-f", "-"],
      JSON.stringify(createManifest(options)));
    await waitForKubernetesDeployment(
      options.kubernetes,
      options.name);
    forwarding = options.kubernetes.startKubectl([
      "port-forward",
      `service/${options.name}`,
      "--namespace",
      options.kubernetes.namespace,
      "--address",
      "127.0.0.1",
      `${String(hostControlPort)}:${String(controlPort)}`
    ]);
    await waitForEndpoint(
      "127.0.0.1",
      hostControlPort,
      30_000);
    logs = options.kubernetes.startKubectl([
      "logs",
      "--follow",
      `deployment/${options.name}`,
      "--namespace",
      options.kubernetes.namespace,
      "--all-containers=true"
    ]);
  } catch (error) {
    await stopProcesses(forwarding, logs);
    await scaleToZero(options).catch(() => undefined);
    throw error;
  }

  let stopped = false;
  return {
    endpoint:
      `https://${options.name}.${options.kubernetes.namespace}.svc:`
      + String(grpcPort),
    controlEndpoint:
      `http://127.0.0.1:${String(hostControlPort)}`,
    diagnostics: () => [
      logs?.diagnostics() ?? "",
      forwarding?.diagnostics() ?? ""
    ].filter((value) => value.length > 0).join("\n"),
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      await stopProcesses(forwarding, logs);
      await scaleToZero(options);
    }
  };
}

function createManifest(
  options: NodeTestServiceOptions
): object {
  const namespace = options.kubernetes.namespace;
  const selector = { "app.kubernetes.io/name": options.name };
  return {
    apiVersion: "v1",
    kind: "List",
    items: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: {
          name: options.name,
          namespace
        },
        spec: {
          replicas: 1,
          strategy: { type: "Recreate" },
          selector: { matchLabels: selector },
          template: {
            metadata: { labels: selector },
            spec: {
              automountServiceAccountToken: false,
              containers: [
                {
                  name: options.name,
                  image: options.image,
                  imagePullPolicy: "Never",
                  env: Object.entries(options.environment).map(
                    ([name, value]) => ({ name, value })),
                  ports: [
                    { containerPort: grpcPort, name: "grpc" },
                    { containerPort: controlPort, name: "control" }
                  ],
                  readinessProbe: {
                    httpGet: {
                      path: "/readyz",
                      port: "control"
                    },
                    periodSeconds: 1,
                    timeoutSeconds: 1,
                    failureThreshold: 30
                  },
                  securityContext: {
                    allowPrivilegeEscalation: false,
                    runAsNonRoot: true,
                    runAsUser: process.getuid?.() ?? 1000
                  },
                  volumeMounts: [
                    {
                      mountPath: "/ctlflow-context",
                      name: "context",
                      readOnly: true
                    }
                  ]
                }
              ],
              volumes: [
                {
                  name: "context",
                  hostPath: {
                    path: path.posix.join(
                      options.kubernetes.storage.nodeRoot,
                      options.storageDirectory),
                    type: "Directory"
                  }
                }
              ]
            }
          }
        }
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: {
          name: options.name,
          namespace
        },
        spec: {
          selector,
          ports: [
            {
              name: "grpc",
              port: grpcPort,
              targetPort: "grpc"
            },
            {
              name: "control",
              port: controlPort,
              targetPort: "control"
            }
          ]
        }
      }
    ]
  };
}

async function stopProcesses(
  forwarding: ManagedProcess | undefined,
  logs: ManagedProcess | undefined
): Promise<void> {
  if (forwarding !== undefined) {
    await stopProcess(forwarding).catch(() => undefined);
  }
  if (logs !== undefined) {
    await stopProcess(logs).catch(() => undefined);
  }
}

async function scaleToZero(
  options: NodeTestServiceOptions
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
    throw new Error("Node test service name is not a Kubernetes DNS label");
  }
}

function validateStorageDirectory(value: string): void {
  if (
    value.length === 0
    || path.isAbsolute(value)
    || value.split(/[\\/]/u).some(
      (segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error("Node test service storage directory is invalid");
  }
}

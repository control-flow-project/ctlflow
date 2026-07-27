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

const defaultServicePort = 50051;
const defaultControlPort = 8080;

export async function startNodeTestService(
  options: NodeTestServiceOptions
): Promise<NodeTestService> {
  validateName(options.name);
  validateStorageDirectory(options.storageDirectory);
  validateWorkloadTokenAudience(
    options.workloadTokenAudience);
  const servicePort = options.servicePort ?? defaultServicePort;
  const controlPort = options.controlPort ?? defaultControlPort;
  const serviceScheme = options.serviceScheme ?? "https";
  validatePort(servicePort);
  validatePort(controlPort);
  if (servicePort === controlPort) {
    throw new Error("Node test service ports must be distinct");
  }
  const hostServicePort = await findAvailablePort();
  const hostControlPort = await findAvailablePort();
  let serviceForwarding: ManagedProcess | undefined;
  let forwarding: ManagedProcess | undefined;
  let logs: ManagedProcess | undefined;

  try {
    await options.kubernetes.runKubectl(
      ["apply", "-f", "-"],
      JSON.stringify(createManifest(
        options,
        servicePort,
        controlPort)));
    await waitForKubernetesDeployment(
      options.kubernetes,
      options.name);
    serviceForwarding = options.kubernetes.startKubectl([
      "port-forward",
      `service/${options.name}`,
      "--namespace",
      options.kubernetes.namespace,
      "--address",
      "127.0.0.1",
      `${String(hostServicePort)}:${String(servicePort)}`
    ]);
    forwarding = options.kubernetes.startKubectl([
      "port-forward",
      `service/${options.name}`,
      "--namespace",
      options.kubernetes.namespace,
      "--address",
      "127.0.0.1",
      `${String(hostControlPort)}:${String(controlPort)}`
    ]);
    await Promise.all([
      waitForEndpoint("127.0.0.1", hostServicePort, 30_000),
      waitForEndpoint("127.0.0.1", hostControlPort, 30_000)
    ]);
    logs = options.kubernetes.startKubectl([
      "logs",
      "--follow",
      `deployment/${options.name}`,
      "--namespace",
      options.kubernetes.namespace,
      "--all-containers=true"
    ]);
  } catch (error) {
    await stopProcesses(serviceForwarding, forwarding, logs);
    await scaleToZero(options).catch(() => undefined);
    throw error;
  }

  let stopped = false;
  return {
    endpoint:
      `${serviceScheme}://${options.name}.`
      + `${options.kubernetes.namespace}.svc:${String(servicePort)}`,
    localEndpoint:
      `${serviceScheme}://127.0.0.1:${String(hostServicePort)}`,
    controlEndpoint:
      `http://127.0.0.1:${String(hostControlPort)}`,
    diagnostics: () => [
      logs?.diagnostics() ?? "",
      serviceForwarding?.diagnostics() ?? "",
      forwarding?.diagnostics() ?? ""
    ].filter((value) => value.length > 0).join("\n"),
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      await stopProcesses(serviceForwarding, forwarding, logs);
      await scaleToZero(options);
    }
  };
}

function createManifest(
  options: NodeTestServiceOptions,
  servicePort: number,
  controlPort: number
): object {
  const namespace = options.kubernetes.namespace;
  const selector = { "app.kubernetes.io/name": options.name };
  return {
    apiVersion: "v1",
    kind: "List",
    items: [
      ...(options.workloadTokenAudience === undefined
        ? []
        : [{
            apiVersion: "v1",
            kind: "ServiceAccount",
            metadata: {
              name: options.name,
              namespace
            },
            automountServiceAccountToken: false
          }]),
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
              ...(options.workloadTokenAudience === undefined
                ? {}
                : {
                    serviceAccountName: options.name
                  }),
              containers: [
                {
                  name: options.name,
                  image: options.image,
                  imagePullPolicy: "Never",
                  env: Object.entries(options.environment).map(
                    ([name, value]) => ({ name, value })),
                  ports: [
                    { containerPort: servicePort, name: "service" },
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
                    },
                    ...(options.workloadTokenAudience === undefined
                      ? []
                      : [{
                          mountPath:
                            "/var/run/secrets/ctlflow",
                          name: "workload-token",
                          readOnly: true
                        }])
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
                },
                ...(options.workloadTokenAudience === undefined
                  ? []
                  : [{
                      name: "workload-token",
                      projected: {
                        defaultMode: 0o440,
                        sources: [{
                          serviceAccountToken: {
                            audience:
                              options.workloadTokenAudience,
                            expirationSeconds: 600,
                            path: "token"
                          }
                        }]
                      }
                    }])
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
              name: "service",
              port: servicePort,
              targetPort: "service"
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
  serviceForwarding: ManagedProcess | undefined,
  forwarding: ManagedProcess | undefined,
  logs: ManagedProcess | undefined
): Promise<void> {
  if (serviceForwarding !== undefined) {
    await stopProcess(serviceForwarding).catch(() => undefined);
  }
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

function validateWorkloadTokenAudience(
  value: string | undefined
): void {
  if (
    value !== undefined
    && (value.length === 0 || value.length > 256)
  ) {
    throw new Error(
      "Node test service workload token audience is invalid");
  }
}

function validatePort(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error("Node test service port is invalid");
  }
}

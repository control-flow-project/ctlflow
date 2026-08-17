import {
  chmod,
  mkdtemp,
  mkdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type {
  TestKubernetes
} from "../kubernetes/test-kubernetes.js";
import { runCommand } from "../processes/run-command.js";
import type {
  OpenTelemetryCollector
} from "./open-telemetry-collector.js";

const serviceName = "otel-collector-test";
const imageTag =
  "otel/opentelemetry-collector-contrib:0.135.0";
const imageDigest =
  "sha256:89107a3a8f4636a396927edf7025bb9614b8da2d92f4cc3f43109e8d115736e2";

export async function startOpenTelemetryCollector(
  repositoryRoot: string,
  kubernetes: TestKubernetes
): Promise<OpenTelemetryCollector> {
  const root = path.join(
    kubernetes.storage.hostRoot,
    "otel");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(
    path.join(root, "session-"));
  const outputDirectory = path.join(directory, "output");
  const configPath = path.join(directory, "collector.yaml");
  const tracesPath = path.join(outputDirectory, "traces.json");
  const metricsPath = path.join(outputDirectory, "metrics.json");
  const logsPath = path.join(outputDirectory, "logs.json");

  await mkdir(outputDirectory);
  await chmod(directory, 0o777);
  await chmod(outputDirectory, 0o777);
  await initializeOutputs(tracesPath, metricsPath, logsPath);
  await writeFile(configPath, createConfiguration(), "utf8");
  await chmod(configPath, 0o644);
  await loadCollectorImage(repositoryRoot, kubernetes);
  await kubernetes.runKubectl(
    ["apply", "-f", "-"],
    JSON.stringify(createManifest(
      kubernetes,
      path.relative(kubernetes.storage.hostRoot, directory))));
  await waitForCollector(kubernetes);

  let stopped = false;
  let suspended = false;
  return {
    endpoint:
      `http://${serviceName}.${kubernetes.namespace}.svc:4318`,
    tracesPath,
    metricsPath,
    logsPath,
    clearExports: async () => {
      requireRunning(stopped);
      if (suspended) {
        throw new Error("Cannot clear exports while the OpenTelemetry Collector is suspended");
      }

      await scale(kubernetes, 0);
      try {
        await waitForCollector(kubernetes);
        await initializeOutputs(tracesPath, metricsPath, logsPath);
      } finally {
        await scale(kubernetes, 1);
        await waitForCollector(kubernetes);
      }
    },
    suspend: async () => {
      requireRunning(stopped);
      if (suspended) {
        return;
      }

      await scale(kubernetes, 0);
      suspended = true;
    },
    resume: async () => {
      requireRunning(stopped);
      if (!suspended) {
        return;
      }

      await scale(kubernetes, 1);
      await waitForCollector(kubernetes);
      suspended = false;
    },
    stop: async () => {
      if (stopped) {
        return;
      }

      stopped = true;
      await scale(kubernetes, 0);
    }
  };
}

async function loadCollectorImage(
  repositoryRoot: string,
  kubernetes: TestKubernetes
): Promise<void> {
  await runCommand(
    "docker",
    ["pull", `${imageTag}@${imageDigest}`],
    { cwd: repositoryRoot });
  await runCommand(
    "docker",
    [
      "image",
      "tag",
      `${imageTag}@${imageDigest}`,
      imageTag
    ],
    { cwd: repositoryRoot });
  const digests = JSON.parse((await runCommand(
    "docker",
    [
      "image",
      "inspect",
      imageTag,
      "--format",
      "{{json .RepoDigests}}"
    ],
    { cwd: repositoryRoot })).stdout) as readonly string[];
  if (!digests.some((value) => value.endsWith(`@${imageDigest}`))) {
    throw new Error("OpenTelemetry Collector image digest is not pinned");
  }

  await kubernetes.loadImage(imageTag);
}

async function initializeOutputs(
  tracesPath: string,
  metricsPath: string,
  logsPath: string
): Promise<void> {
  for (const output of [tracesPath, metricsPath, logsPath]) {
    await writeFile(output, "", "utf8");
    await chmod(output, 0o666);
  }
}

async function scale(
  kubernetes: TestKubernetes,
  replicas: 0 | 1
): Promise<void> {
  await kubernetes.runKubectl([
    "scale",
    `deployment/${serviceName}`,
    "--namespace",
    kubernetes.namespace,
    `--replicas=${String(replicas)}`
  ]);
}

async function waitForCollector(
  kubernetes: TestKubernetes
): Promise<void> {
  await kubernetes.runKubectl([
    "rollout",
    "status",
    `deployment/${serviceName}`,
    "--namespace",
    kubernetes.namespace,
    "--timeout=90s"
  ]);
}

function requireRunning(stopped: boolean): void {
  if (stopped) {
    throw new Error("OpenTelemetry Collector is stopped");
  }
}

function createManifest(
  kubernetes: TestKubernetes,
  storageDirectory: string
): object {
  const selector = { "app.kubernetes.io/name": serviceName };
  return {
    apiVersion: "v1",
    kind: "List",
    items: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: {
          name: serviceName,
          namespace: kubernetes.namespace
        },
        spec: {
          replicas: 1,
          strategy: { type: "Recreate" },
          selector: { matchLabels: selector },
          template: {
            metadata: {
              annotations: {
                "ctlflow.test/revision": Date.now().toString(36)
              },
              labels: selector
            },
            spec: {
              automountServiceAccountToken: false,
              containers: [
                {
                  name: "collector",
                  image: imageTag,
                  imagePullPolicy: "Never",
                  args: ["--config=/state/collector.yaml"],
                  ports: [
                    {
                      containerPort: 4318,
                      name: "otlp-http"
                    }
                  ],
                  readinessProbe: {
                    tcpSocket: { port: "otlp-http" },
                    periodSeconds: 1,
                    timeoutSeconds: 1,
                    failureThreshold: 60
                  },
                  securityContext: {
                    allowPrivilegeEscalation: false,
                    runAsNonRoot: true
                  },
                  volumeMounts: [
                    {
                      mountPath: "/state",
                      name: "state"
                    }
                  ]
                }
              ],
              volumes: [
                {
                  name: "state",
                  hostPath: {
                    path: path.posix.join(
                      kubernetes.storage.nodeRoot,
                      storageDirectory),
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
          name: serviceName,
          namespace: kubernetes.namespace
        },
        spec: {
          selector,
          ports: [
            {
              name: "otlp-http",
              port: 4318,
              targetPort: "otlp-http"
            }
          ]
        }
      }
    ]
  };
}

function createConfiguration(): string {
  return `receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
exporters:
  file/traces:
    path: /state/output/traces.json
  file/metrics:
    path: /state/output/metrics.json
  file/logs:
    path: /state/output/logs.json
service:
  telemetry:
    logs:
      level: error
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [file/traces]
    metrics:
      receivers: [otlp]
      exporters: [file/metrics]
    logs:
      receivers: [otlp]
      exporters: [file/logs]
`;
}

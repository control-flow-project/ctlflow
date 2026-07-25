import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import type {
  RegisterTestAggregatedApiOptions
} from "./test-kubernetes.js";
import { runCommand } from "../processes/run-command.js";

export async function registerTestAggregatedApi(
  repositoryRoot: string,
  controlPlane: string,
  options: RegisterTestAggregatedApiOptions
): Promise<void> {
  const gateway = (await runCommand(
    "docker",
    [
      "inspect",
      "--format",
      "{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}",
      controlPlane
    ],
    { cwd: repositoryRoot })).stdout.trim();
  if (gateway.length === 0) {
    throw new Error("Kind control plane has no host gateway");
  }
  const hostAddress = await findReachableHostAddress(
    repositoryRoot,
    controlPlane,
    options.hostPort,
    gateway);

  const certificateAuthority = await readFile(
    options.serverCertificateAuthorityPath);
  const apiServiceName = `${options.version}.${options.group}`;
  await clearPreviousRegistration(
    repositoryRoot,
    controlPlane,
    apiServiceName,
    options.serviceName,
    options.serviceNamespace);
  const manifest = JSON.stringify({
    apiVersion: "v1",
    kind: "List",
    items: [
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: {
          name: options.serviceName,
          namespace: options.serviceNamespace
        },
        spec: {
          ports: [
            {
              name: "https",
              port: 443,
              protocol: "TCP",
              targetPort: options.hostPort
            }
          ]
        }
      },
      {
        apiVersion: "discovery.k8s.io/v1",
        kind: "EndpointSlice",
        metadata: {
          name: `${options.serviceName}-host`,
          namespace: options.serviceNamespace,
          labels: {
            "kubernetes.io/service-name": options.serviceName
          }
        },
        addressType: "IPv4",
        endpoints: [
          {
            addresses: [hostAddress],
            conditions: { ready: true }
          }
        ],
        ports: [
          {
            name: "https",
            port: options.hostPort,
            protocol: "TCP"
          }
        ]
      },
      {
        apiVersion: "apiregistration.k8s.io/v1",
        kind: "APIService",
        metadata: { name: apiServiceName },
        spec: {
          caBundle: certificateAuthority.toString("base64"),
          group: options.group,
          groupPriorityMinimum: 1000,
          service: {
            name: options.serviceName,
            namespace: options.serviceNamespace,
            port: 443
          },
          version: options.version,
          versionPriority: 15
        }
      }
    ]
  });
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
      input: manifest
  });
}

async function clearPreviousRegistration(
  repositoryRoot: string,
  controlPlane: string,
  apiServiceName: string,
  serviceName: string,
  serviceNamespace: string
): Promise<void> {
  const kubectl = [
    "exec",
    controlPlane,
    "kubectl",
    "--kubeconfig=/etc/kubernetes/admin.conf"
  ];
  await runCommand(
    "docker",
    [
      ...kubectl,
      "delete",
      `apiservice/${apiServiceName}`,
      "--ignore-not-found=true",
      "--wait=true"
    ],
    { cwd: repositoryRoot });
  await runCommand(
    "docker",
    [
      ...kubectl,
      "delete",
      `service/${serviceName}`,
      `endpointslice/${serviceName}-host`,
      "--namespace",
      serviceNamespace,
      "--ignore-not-found=true",
      "--wait=true"
    ],
    { cwd: repositoryRoot });
}

async function findReachableHostAddress(
  repositoryRoot: string,
  controlPlane: string,
  hostPort: number,
  gateway: string
): Promise<string> {
  const interfaceAddresses = Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) =>
      address.family === "IPv4"
      && !address.internal
      && isIP(address.address) === 4)
    .map((address) => address.address);
  const candidates = [...new Set([...interfaceAddresses, gateway])];

  for (const candidate of candidates) {
    const probe = await runCommand(
      "docker",
      [
        "exec",
        controlPlane,
        "bash",
        "-c",
        `timeout 2 bash -c '</dev/tcp/${candidate}/${String(hostPort)}'`
      ],
      { cwd: repositoryRoot })
      .then(() => true)
      .catch(() => false);
    if (probe) {
      return candidate;
    }
  }

  throw new Error(
    "Kind control plane cannot reach the host aggregation listener");
}

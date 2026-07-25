import { createSign } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  TestCallerCredentials,
  TestKubernetes,
  TestLifecycleOwnerCredentials,
  TestWorkloadCredentials
} from "./test-kubernetes.js";
import {
  createAggregationCredentials
} from "./create-aggregation-credentials.js";
import {
  createKubernetesApiCredentials
} from "./create-kubernetes-api-credentials.js";
import {
  createTestWorkloads,
  type TestWorkloadDefinition
} from "./create-test-workloads.js";
import {
  registerTestAggregatedApi
} from "./register-test-aggregated-api.js";
import { runKubectl } from "./run-kubectl.js";
import { runCommand } from "../processes/run-command.js";

const audience = "ctlflow-internal";
const clusterName = "ctlflow-test-mesh";
const namespaceName = "ctlflow-tests";
const serviceAccountName = "kernel-caller";
const podName = "kernel-caller";
const unadmittedServiceAccountName = "unadmitted-caller";
const unadmittedPodName = "unadmitted-caller";
const lifecycleWorkloads = {
  identity: {
    serviceAccountName: "identity-owner",
    podName: "identity-owner"
  },
  configuration: {
    serviceAccountName: "configuration-owner",
    podName: "configuration-owner"
  },
  execution: {
    serviceAccountName: "execution-owner",
    podName: "execution-owner"
  },
  packages: {
    serviceAccountName: "packages-owner",
    podName: "packages-owner"
  }
} as const satisfies Record<string, TestWorkloadDefinition>;

export async function startTestKubernetes(
  repositoryRoot: string
): Promise<TestKubernetes> {
  const root = path.join(
    repositoryRoot,
    ".temp",
    "test-mesh",
    "kubernetes");
  const sessions = path.join(root, "sessions");
  await mkdir(sessions, { recursive: true });
  const directory = await mkdtemp(
    path.join(sessions, "session-"));
  const kubeconfigPath = path.join(root, "kubeconfig");
  const kind = process.env.CTLFLOW_KIND_PATH ?? "kind";
  const controlPlane = `${clusterName}-control-plane`;

  try {
    await acquireTestCluster(
      kind,
      repositoryRoot,
      controlPlane,
      kubeconfigPath);

    await createTestWorkloads(
      repositoryRoot,
      controlPlane,
      namespaceName,
      [
        { serviceAccountName, podName },
        {
          serviceAccountName: unadmittedServiceAccountName,
          podName: unadmittedPodName
        },
        ...Object.values(lifecycleWorkloads)
      ]);

    const jwks = (await runKubectl(
      repositoryRoot,
      controlPlane,
      ["get", "--raw", "/openid/v1/jwks"])).stdout;
    const signingKey = (await runCommand(
      "docker",
      [
        "exec",
        controlPlane,
        "cat",
        "/etc/kubernetes/pki/sa.key"
      ],
      { cwd: repositoryRoot })).stdout;
    const discovery = JSON.parse((await runKubectl(
      repositoryRoot,
      controlPlane,
      ["get", "--raw", "/.well-known/openid-configuration"])).stdout) as {
        readonly issuer?: unknown;
      };

    const issuer = discovery.issuer;
    if (typeof issuer !== "string") {
      throw new Error("Kubernetes did not return a usable issuer");
    }

    const jwksPath = path.join(directory, "workload-jwks.json");
    await writeFile(jwksPath, jwks, "utf8");
    const api = await createKubernetesApiCredentials(
      kubeconfigPath,
      directory);
    const aggregation = await createAggregationCredentials(
      repositoryRoot,
      controlPlane,
      directory);

    let stopped = false;
    return {
      aggregation,
      api,
      createWorkloadCredentials: async () => {
        if (stopped) {
          throw new Error("Test Kubernetes cluster is stopped");
        }

        return createWorkloadCredentials(
          repositoryRoot,
          controlPlane,
          issuer,
          jwksPath,
          signingKey);
      },
      createLifecycleOwnerCredentials: async () => {
        if (stopped) {
          throw new Error("Test Kubernetes cluster is stopped");
        }

        return await createLifecycleOwnerCredentials(
          repositoryRoot,
          controlPlane);
      },
      registerAggregatedApi: async (options) => {
        if (stopped) {
          throw new Error("Test Kubernetes cluster is stopped");
        }

        await registerTestAggregatedApi(
          repositoryRoot,
          controlPlane,
          options);
      },
      stop: async () => {
        if (stopped) {
          return;
        }

        stopped = true;
      }
    };
  } catch (error) {
    throw error;
  }
}

async function acquireTestCluster(
  kind: string,
  repositoryRoot: string,
  controlPlane: string,
  kubeconfigPath: string
): Promise<void> {
  const clusters = (await runCommand(
    kind,
    ["get", "clusters"],
    { cwd: repositoryRoot })).stdout
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (!clusters.includes(clusterName)) {
    await runCommand(
      kind,
      [
        "create",
        "cluster",
        "--name",
        clusterName,
        "--kubeconfig",
        kubeconfigPath,
        "--wait",
        "120s"
      ],
      { cwd: repositoryRoot });
    return;
  }

  const running = (await runCommand(
    "docker",
    [
      "inspect",
      "--format",
      "{{.State.Running}}",
      controlPlane
    ],
    { cwd: repositoryRoot })).stdout.trim();
  if (running !== "true") {
    throw new Error(
      `Reusable Kind control plane ${controlPlane} is not running`);
  }

  const kubeconfig = (await runCommand(
    kind,
    ["get", "kubeconfig", "--name", clusterName],
    { cwd: repositoryRoot })).stdout;
  if (kubeconfig.trim().length === 0) {
    throw new Error("Reusable Kind cluster returned an empty kubeconfig");
  }

  await writeFile(kubeconfigPath, kubeconfig, {
    encoding: "utf8",
    mode: 0o600
  });
}

async function createLifecycleOwnerCredentials(
  repositoryRoot: string,
  controlPlane: string
): Promise<TestLifecycleOwnerCredentials> {
  return {
    identity: await createCallerCredentials(
      repositoryRoot,
      controlPlane,
      lifecycleWorkloads.identity),
    configuration: await createCallerCredentials(
      repositoryRoot,
      controlPlane,
      lifecycleWorkloads.configuration),
    execution: await createCallerCredentials(
      repositoryRoot,
      controlPlane,
      lifecycleWorkloads.execution),
    packages: await createCallerCredentials(
      repositoryRoot,
      controlPlane,
      lifecycleWorkloads.packages)
  };
}

async function createCallerCredentials(
  repositoryRoot: string,
  controlPlane: string,
  workload: TestWorkloadDefinition
): Promise<TestCallerCredentials> {
  return {
    callerSubject:
      `system:serviceaccount:${namespaceName}:${workload.serviceAccountName}`,
    callerToken: await createToken(
      repositoryRoot,
      controlPlane,
      workload.serviceAccountName,
      audience,
      "10m",
      workload.podName)
  };
}

async function createWorkloadCredentials(
  repositoryRoot: string,
  controlPlane: string,
  issuer: string,
  jwksPath: string,
  signingKey: string
): Promise<TestWorkloadCredentials> {
  const token = await createToken(
    repositoryRoot,
    controlPlane,
    serviceAccountName,
    audience,
    "10m",
    podName);
  const unadmittedToken = await createToken(
    repositoryRoot,
    controlPlane,
    unadmittedServiceAccountName,
    audience,
    "10m",
    unadmittedPodName);
  const wrongAudienceToken = await createToken(
    repositoryRoot,
    controlPlane,
    serviceAccountName,
    "wrong-audience",
    "10m",
    podName);
  const overlongToken = await createToken(
    repositoryRoot,
    controlPlane,
    serviceAccountName,
    audience,
    "20m",
    podName);
  const unboundToken = await createToken(
    repositoryRoot,
    controlPlane,
    serviceAccountName,
    audience,
    "10m");

  return {
    issuer,
    audience,
    callerSubject:
      `system:serviceaccount:${namespaceName}:${serviceAccountName}`,
    callerToken: token,
    expiredToken: createExpiredToken(token, signingKey),
    overlongToken,
    unadmittedToken,
    wrongAudienceToken,
    unboundToken,
    jwksPath
  };
}

async function createToken(
  repositoryRoot: string,
  controlPlane: string,
  serviceAccount: string,
  tokenAudience: string,
  duration: string,
  boundPod?: string
): Promise<string> {
  const binding = boundPod === undefined
    ? []
    : [
        "--bound-object-kind=Pod",
        `--bound-object-name=${boundPod}`
      ];
  const token = (await runKubectl(
    repositoryRoot,
    controlPlane,
    [
      "create",
      "token",
      serviceAccount,
      "--namespace",
      namespaceName,
      `--audience=${tokenAudience}`,
      `--duration=${duration}`,
      ...binding
    ])).stdout.trim();

  if (token.length === 0) {
    throw new Error("Kubernetes did not return a usable workload token");
  }

  return token;
}

function createExpiredToken(token: string, privateKey: string): string {
  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new Error("Kubernetes returned a malformed workload token");
  }

  const payload = JSON.parse(
    Buffer.from(segments[1]!, "base64url").toString("utf8")
  ) as Record<string, unknown>;
  const now = Math.floor(Date.now() / 1_000);
  payload.iat = now - 120;
  payload.nbf = now - 120;
  payload.exp = now - 60;

  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
    "utf8"
  ).toString("base64url");
  const signingInput = `${segments[0]!}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

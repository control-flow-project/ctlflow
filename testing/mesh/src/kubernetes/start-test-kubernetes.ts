import {
  randomUUID
} from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type {
  TestKubernetes,
  TestWorkloadCredentials
} from "./test-kubernetes.js";
import {
  createKubernetesApiCredentials
} from "./create-kubernetes-api-credentials.js";
import {
  createKubernetesOperatorCredentials
} from "./create-kubernetes-operator-credentials.js";
import {
  createSignedTokenVariant
} from "./create-signed-token-variant.js";
import {
  createTestWorkloads
} from "./create-test-workloads.js";
import { loadTestToolchain } from "./load-test-toolchain.js";
import { readMinikubeFile } from "./read-minikube-file.js";
import { resolveKubectl } from "./resolve-kubectl.js";
import { resolveMinikube } from "./resolve-minikube.js";
import {
  resolveLoadedImageArtifact
} from "./resolve-loaded-image-artifact.js";
import { runMinikube } from "./run-minikube.js";
import { runKubectl } from "./run-kubectl.js";
import { startKubectl } from "./start-kubectl.js";
import { runCommand } from "../processes/run-command.js";
import type { TestMinikube } from "./test-minikube.js";

const audience = "ctlflow-internal";
const serviceAccountName = "kernel-caller";
const podName = "kernel-caller";
const unadmittedServiceAccountName = "unadmitted-caller";
const unadmittedPodName = "unadmitted-caller";
export async function startTestKubernetes(
  repositoryRoot: string
): Promise<TestKubernetes> {
  const namespaceName =
    `ctlflow-test-${randomUUID().slice(0, 12)}`;
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
  const toolchain = await loadTestToolchain(repositoryRoot);
  const minikube: TestMinikube = {
    executable: await resolveMinikube(repositoryRoot, toolchain),
    toolchain
  };

  try {
    await acquireTestCluster(
      repositoryRoot,
      minikube,
      kubeconfigPath);

    await createTestWorkloads(
      repositoryRoot,
      minikube,
      namespaceName,
      [
        { serviceAccountName, podName },
        {
          serviceAccountName: unadmittedServiceAccountName,
          podName: unadmittedPodName
        }
      ]);

    const jwks = (await runKubectl(
      repositoryRoot,
      minikube,
      ["get", "--raw", "/openid/v1/jwks"])).stdout;
    const signingKey = await readMinikubeFile(
      repositoryRoot,
      minikube,
      "/var/lib/minikube/certs/sa.key");
    const discovery = JSON.parse((await runKubectl(
      repositoryRoot,
      minikube,
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
    const storage = await createTestStorage(
      repositoryRoot,
      minikube);
    const kubectl = await resolveKubectl(
      repositoryRoot,
      minikube);
    const loadedImages = await readLoadedImages(
      repositoryRoot,
      minikube);

    let stopped = false;
    return {
      namespace: namespaceName,
      api,
      storage,
      createWorkloadCredentials: async (
        requestedServiceAccountName = serviceAccountName,
        requestedAudience = audience
      ) => {
        if (stopped) {
          throw new Error("Test Kubernetes cluster is stopped");
        }
        validateWorkloadName(requestedServiceAccountName);
        await createTestWorkloads(
          repositoryRoot,
          minikube,
          namespaceName,
          [{
            serviceAccountName: requestedServiceAccountName,
            podName: requestedServiceAccountName
          }]);

        return createWorkloadCredentials(
          repositoryRoot,
          minikube,
          namespaceName,
          issuer,
          jwksPath,
          signingKey,
          requestedServiceAccountName,
          requestedServiceAccountName,
          requestedAudience);
      },
      createOperatorCredentials: async (subject) => {
        if (stopped) {
          throw new Error("Test Kubernetes cluster is stopped");
        }
        return await createKubernetesOperatorCredentials(
          repositoryRoot,
          directory,
          api.certificateAuthorityPath,
          await readMinikubeFile(
            repositoryRoot,
            minikube,
            "/var/lib/minikube/certs/ca.key"),
          subject);
      },
      loadImage: async (image) => {
        if (stopped) {
          throw new Error("Test Kubernetes cluster is stopped");
        }
        const canonical = image.includes("/")
          ? image
          : `docker.io/library/${image}`;
        if (loadedImages.has(canonical)) {
          return;
        }

        await runMinikube(
          repositoryRoot,
          minikube,
          ["image", "load", image]);
        loadedImages.add(canonical);
      },
      resolveImageArtifact: async (image) => {
        if (stopped) {
          throw new Error("Test Kubernetes cluster is stopped");
        }
        return await resolveLoadedImageArtifact(
          repositoryRoot,
          minikube,
          image);
      },
      runKubectl: async (arguments_, input) => {
        if (stopped) {
          throw new Error("Test Kubernetes cluster is stopped");
        }

        return await runKubectl(
          repositoryRoot,
          minikube,
          arguments_,
          input === undefined ? undefined : { input });
      },
      runNodeCommand: async (arguments_) => {
        if (stopped) {
          throw new Error("Test Kubernetes cluster is stopped");
        }

        return await runMinikube(
          repositoryRoot,
          minikube,
          ["ssh", "--", "sudo", ...arguments_]);
      },
      startKubectl: (arguments_) => {
        if (stopped) {
          throw new Error("Test Kubernetes cluster is stopped");
        }

        return startKubectl(
          repositoryRoot,
          kubectl,
          kubeconfigPath,
          arguments_);
      },
      stop: async () => {
        if (stopped) {
          return;
        }

        stopped = true;
        await runKubectl(
          repositoryRoot,
          minikube,
          [
            "delete",
            "namespace",
            namespaceName,
            "--ignore-not-found=true",
            "--wait=false"
          ]);
      }
    };
  } catch (error) {
    await runKubectl(
      repositoryRoot,
      minikube,
      [
        "delete",
        "namespace",
        namespaceName,
        "--ignore-not-found=true",
        "--wait=true",
        "--timeout=30s"
      ])
      .catch(() => undefined);
    throw error;
  }
}

async function readLoadedImages(
  repositoryRoot: string,
  minikube: TestMinikube
): Promise<Set<string>> {
  const result = await runMinikube(
    repositoryRoot,
    minikube,
    [
      "image",
      "ls",
      "--format",
      "{{.Repository}}:{{.Tag}}"
    ]);
  return new Set(
    result.stdout
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter((value) => value.length > 0));
}

async function createTestStorage(
  repositoryRoot: string,
  minikube: TestMinikube
): Promise<{
  readonly hostRoot: string;
  readonly nodeRoot: string;
}> {
  const volume = (await runCommand(
    "docker",
    [
      "volume",
      "inspect",
      minikube.toolchain.profile,
      "--format",
      "{{.Mountpoint}}"
    ],
    { cwd: repositoryRoot })).stdout.trim();
  if (!path.isAbsolute(volume)) {
    throw new Error("Minikube Docker volume mountpoint is invalid");
  }

  const hostRoot = path.join(volume, "ctlflow-tests");
  await mkdir(hostRoot, { recursive: true });
  await chmod(hostRoot, 0o777);
  return {
    hostRoot,
    nodeRoot: "/var/ctlflow-tests"
  };
}

async function acquireTestCluster(
  repositoryRoot: string,
  minikube: TestMinikube,
  kubeconfigPath: string
): Promise<void> {
  const profile = await readProfile(repositoryRoot, minikube);
  if (profile === undefined || profile.status !== "OK") {
    await startMinikube(repositoryRoot, minikube);
  }

  await validateProfile(repositoryRoot, minikube);
  const kubeconfig = (await runKubectl(
    repositoryRoot,
    minikube,
    ["config", "view", "--raw", "--minify", "--flatten"])).stdout;
  if (kubeconfig.trim().length === 0) {
    throw new Error("Reusable Minikube profile returned an empty kubeconfig");
  }

  await writeFile(kubeconfigPath, kubeconfig, {
    encoding: "utf8",
    mode: 0o600
  });
}

interface MinikubeProfile {
  readonly status: string;
  readonly driver: string;
  readonly runtime: string;
  readonly kubernetesVersion: string;
}

async function readProfile(
  repositoryRoot: string,
  minikube: TestMinikube
): Promise<MinikubeProfile | undefined> {
  const output = await runCommand(
    minikube.executable,
    ["profile", "list", "--output=json"],
    { cwd: repositoryRoot });
  const document = JSON.parse(output.stdout) as {
    readonly valid?: readonly {
      readonly Name?: unknown;
      readonly Status?: unknown;
      readonly Config?: {
        readonly Driver?: unknown;
        readonly KubernetesConfig?: {
          readonly ContainerRuntime?: unknown;
          readonly KubernetesVersion?: unknown;
        };
      };
    }[];
  };
  const profile = document.valid?.find(
    (value) => value.Name === minikube.toolchain.profile);
  if (profile === undefined) {
    return undefined;
  }

  return {
    status: String(profile.Status),
    driver: String(profile.Config?.Driver),
    runtime: String(
      profile.Config?.KubernetesConfig?.ContainerRuntime),
    kubernetesVersion: String(
      profile.Config?.KubernetesConfig?.KubernetesVersion)
  };
}

async function startMinikube(
  repositoryRoot: string,
  minikube: TestMinikube
): Promise<void> {
  const toolchain = minikube.toolchain;
  await runMinikube(
    repositoryRoot,
    minikube,
    [
      "start",
      "--driver",
      toolchain.driver,
      "--container-runtime",
      toolchain.containerRuntime,
      "--kubernetes-version",
      toolchain.kubernetesVersion,
      "--cpus",
      String(toolchain.cpus),
      "--memory",
      `${String(toolchain.memoryMiB)}mb`
    ]);
}

async function validateProfile(
  repositoryRoot: string,
  minikube: TestMinikube
): Promise<void> {
  const profile = await readProfile(repositoryRoot, minikube);
  const expected = minikube.toolchain;
  if (
    profile?.status !== "OK"
    || profile.driver !== expected.driver
    || profile.runtime !== expected.containerRuntime
    || profile.kubernetesVersion !== expected.kubernetesVersion
  ) {
    throw new Error(
      "Reusable Minikube profile does not match the test toolchain");
  }

  const status = JSON.parse((await runMinikube(
    repositoryRoot,
    minikube,
    ["status", "--output=json"])).stdout) as {
      readonly Host?: unknown;
      readonly Kubelet?: unknown;
      readonly APIServer?: unknown;
      readonly Kubeconfig?: unknown;
    };
  if (
    status.Host !== "Running"
    || status.Kubelet !== "Running"
    || status.APIServer !== "Running"
    || status.Kubeconfig !== "Configured"
  ) {
    throw new Error("Reusable Minikube profile is not healthy");
  }
}

async function createWorkloadCredentials(
  repositoryRoot: string,
  minikube: TestMinikube,
  namespaceName: string,
  issuer: string,
  jwksPath: string,
  signingKey: string,
  admittedServiceAccountName: string,
  admittedPodName: string,
  tokenAudience: string
): Promise<TestWorkloadCredentials> {
  const token = await createToken(
    repositoryRoot,
    minikube,
    namespaceName,
    admittedServiceAccountName,
    tokenAudience,
    "10m",
    admittedPodName);
  const unadmittedToken = await createToken(
    repositoryRoot,
    minikube,
    namespaceName,
    unadmittedServiceAccountName,
    tokenAudience,
    "10m",
    unadmittedPodName);
  const wrongAudienceToken = await createToken(
    repositoryRoot,
    minikube,
    namespaceName,
    admittedServiceAccountName,
    "wrong-audience",
    "10m",
    admittedPodName);
  const overlongToken = await createToken(
    repositoryRoot,
    minikube,
    namespaceName,
    admittedServiceAccountName,
    tokenAudience,
    "20m",
    admittedPodName);
  const unboundToken = await createToken(
    repositoryRoot,
    minikube,
    namespaceName,
    admittedServiceAccountName,
    audience,
    "10m");

  return {
    issuer,
    audience: tokenAudience,
    callerSubject:
      `system:serviceaccount:${namespaceName}:`
      + admittedServiceAccountName,
    callerToken: token,
    expiredToken: createExpiredToken(token, signingKey),
    overlongToken,
    unadmittedToken,
    wrongAudienceToken,
    wrongIssuerToken: createSignedTokenVariant(
      token,
      signingKey,
      (payload) => {
        payload.iss = "https://wrong-issuer.invalid";
      }),
    wrongNamespaceToken: createSignedTokenVariant(
      token,
      signingKey,
      (payload) => {
        const namespaceName = "wrong-namespace";
        payload.sub =
          `system:serviceaccount:${namespaceName}:`
          + admittedServiceAccountName;
        const kubernetes = payload["kubernetes.io"] as
          Record<string, unknown>;
        kubernetes.namespace = namespaceName;
      }),
    unboundToken,
    jwksPath
  };
}

function validateWorkloadName(value: string): void {
  if (
    value.length < 1
    || value.length > 63
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(value)
  ) {
    throw new Error("Test workload name is invalid");
  }
}

async function createToken(
  repositoryRoot: string,
  minikube: TestMinikube,
  namespaceName: string,
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
    minikube,
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
  return createSignedTokenVariant(token, privateKey, (payload) => {
    const now = Math.floor(Date.now() / 1_000);
    payload.iat = now - 120;
    payload.nbf = now - 120;
    payload.exp = now - 60;
  });
}

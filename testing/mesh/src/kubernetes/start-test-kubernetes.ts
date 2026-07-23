import { createSign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestKubernetes } from "./test-kubernetes.js";
import { runKubectl } from "./run-kubectl.js";
import { runCommand } from "../processes/run-command.js";

const audience = "ctlflow-internal";
const namespaceName = "tenantd-tests";
const serviceAccountName = "tenantd-caller";
const podName = "tenantd-caller";
const unadmittedServiceAccountName = "unadmitted-caller";
const unadmittedPodName = "unadmitted-caller";

export async function startTestKubernetes(
  repositoryRoot: string
): Promise<TestKubernetes> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "ctlflow-kubernetes-"));
  const clusterName = `ctlflow-${process.pid.toString(36)}-${Date.now().toString(36)}`;
  const kubeconfigPath = path.join(directory, "kubeconfig");
  const kind = process.env.CTLFLOW_KIND_PATH ?? "kind";
  const controlPlane = `${clusterName}-control-plane`;
  let created = false;

  try {
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
    created = true;

    await runKubectl(
      repositoryRoot,
      controlPlane,
      ["create", "namespace", namespaceName]);
    await runKubectl(
      repositoryRoot,
      controlPlane,
      [
        "create",
        "serviceaccount",
        serviceAccountName,
        "--namespace",
        namespaceName
      ]);
    await runKubectl(
      repositoryRoot,
      controlPlane,
      [
        "create",
        "serviceaccount",
        unadmittedServiceAccountName,
        "--namespace",
        namespaceName
      ]);
    await runKubectl(
      repositoryRoot,
      controlPlane,
      [
        "run",
        podName,
        "--namespace",
        namespaceName,
        "--image",
        "registry.k8s.io/pause:3.10",
        "--restart",
        "Never",
        "--overrides",
        JSON.stringify({
          spec: {
            serviceAccountName,
            automountServiceAccountToken: true
          }
        })
      ]);
    await runKubectl(
      repositoryRoot,
      controlPlane,
      [
        "run",
        unadmittedPodName,
        "--namespace",
        namespaceName,
        "--image",
        "registry.k8s.io/pause:3.10",
        "--restart",
        "Never",
        "--overrides",
        JSON.stringify({
          spec: {
            serviceAccountName: unadmittedServiceAccountName,
            automountServiceAccountToken: true
          }
        })
      ]);
    await runKubectl(
      repositoryRoot,
      controlPlane,
      [
        "wait",
        `pod/${podName}`,
        "--namespace",
        namespaceName,
        "--for=condition=Ready",
        "--timeout=90s"
      ]);
    await runKubectl(
      repositoryRoot,
      controlPlane,
      [
        "wait",
        `pod/${unadmittedPodName}`,
        "--namespace",
        namespaceName,
        "--for=condition=Ready",
        "--timeout=90s"
      ]);

    const token = (await runKubectl(
      repositoryRoot,
      controlPlane,
      [
        "create",
        "token",
        serviceAccountName,
        "--namespace",
        namespaceName,
        `--audience=${audience}`,
        "--duration=10m",
        "--bound-object-kind=Pod",
        `--bound-object-name=${podName}`
      ])).stdout.trim();
    const unadmittedToken = (await runKubectl(
      repositoryRoot,
      controlPlane,
      [
        "create",
        "token",
        unadmittedServiceAccountName,
        "--namespace",
        namespaceName,
        `--audience=${audience}`,
        "--duration=10m",
        "--bound-object-kind=Pod",
        `--bound-object-name=${unadmittedPodName}`
      ])).stdout.trim();
    const wrongAudienceToken = (await runKubectl(
      repositoryRoot,
      controlPlane,
      [
        "create",
        "token",
        serviceAccountName,
        "--namespace",
        namespaceName,
        "--audience=wrong-audience",
        "--duration=10m",
        "--bound-object-kind=Pod",
        `--bound-object-name=${podName}`
      ])).stdout.trim();
    const overlongToken = (await runKubectl(
      repositoryRoot,
      controlPlane,
      [
        "create",
        "token",
        serviceAccountName,
        "--namespace",
        namespaceName,
        `--audience=${audience}`,
        "--duration=20m",
        "--bound-object-kind=Pod",
        `--bound-object-name=${podName}`
      ])).stdout.trim();
    const unboundToken = (await runKubectl(
      repositoryRoot,
      controlPlane,
      [
        "create",
        "token",
        serviceAccountName,
        "--namespace",
        namespaceName,
        `--audience=${audience}`,
        "--duration=10m"
      ])).stdout.trim();
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
    const expiredToken = createExpiredToken(token, signingKey);
    const discovery = JSON.parse((await runKubectl(
      repositoryRoot,
      controlPlane,
      ["get", "--raw", "/.well-known/openid-configuration"])).stdout) as {
        readonly issuer?: unknown;
      };

    if (token.length === 0
        || unadmittedToken.length === 0
        || wrongAudienceToken.length === 0
        || overlongToken.length === 0
        || unboundToken.length === 0
        || typeof discovery.issuer !== "string")
    {
      throw new Error("Kubernetes did not return a usable bound token");
    }

    const jwksPath = path.join(directory, "workload-jwks.json");
    await writeFile(jwksPath, jwks, "utf8");

    return {
      issuer: discovery.issuer,
      audience,
      callerSubject:
        `system:serviceaccount:${namespaceName}:${serviceAccountName}`,
      callerToken: token,
      expiredToken,
      overlongToken,
      unadmittedToken,
      wrongAudienceToken,
      unboundToken,
      jwksPath,
      stop: async () => {
        await runCommand(
          kind,
          ["delete", "cluster", "--name", clusterName],
          { cwd: repositoryRoot });
        await rm(directory, { recursive: true, force: true });
      }
    };
  } catch (error) {
    if (created) {
      await runCommand(
        kind,
        ["delete", "cluster", "--name", clusterName],
        { cwd: repositoryRoot }).catch(() => undefined);
    }
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
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

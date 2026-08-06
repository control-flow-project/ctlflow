import assert from "node:assert/strict";
import {
  createServer
} from "node:net";
import {
  stopProcess,
  type TestKubernetes
} from "@ctlflow/test-mesh";
import {
  listOwnedKubernetesObjects
} from "../kubernetes/list-owned-kubernetes-objects.js";
import {
  waitFor
} from "../wait-for.js";

export interface ProductCheckRequest {
  readonly operation: string;
  readonly resourcePath: string;
  readonly tenantId: string;
  readonly workspaceId?: string;
  // Absent for a Run: the container uses its projected invocation.
  readonly invocationToken?: string;
}

export interface ProductCheckResult {
  readonly decision?: "allow" | "deny";
  readonly error?: {
    readonly stage: "bootstrap" | "invocation" | "policy";
    readonly code?: number;
    readonly message?: string;
  };
}

// The production call under test originates inside the realized application
// container from its own projected bootstrap. The port-forward here is only
// the test's way of delivering the triggering request, exactly like an edge
// request would; it grants the container nothing.
export async function callProductApp(
  kubernetes: TestKubernetes,
  namespaceName: string,
  podName: string,
  request: ProductCheckRequest,
  traceParent?: string
): Promise<ProductCheckResult> {
  return await withForwardedPort(
    kubernetes,
    namespaceName,
    podName,
    async (port) => {
      const response = await fetch(
        `http://127.0.0.1:${String(port)}/product-check`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(traceParent === undefined
              ? {}
              : { traceparent: traceParent })
          },
          body: JSON.stringify(request)
        });
      assert.equal(response.status, 200);
      return await response.json() as ProductCheckResult;
    });
}

export async function readProductBootstrap(
  kubernetes: TestKubernetes,
  namespaceName: string,
  podName: string
): Promise<Record<string, unknown>> {
  return await withForwardedPort(
    kubernetes,
    namespaceName,
    podName,
    async (port) => {
      const response = await fetch(
        `http://127.0.0.1:${String(port)}/bootstrap`);
      assert.equal(response.status, 200);
      return await response.json() as Record<string, unknown>;
    });
}

export async function findRunningProductPod(
  kubernetes: TestKubernetes,
  namespaceName: string,
  serviceAccountName: string
): Promise<string> {
  const pod = await waitFor(
    async () => {
      const pods = await listOwnedKubernetesObjects(
        kubernetes,
        "pods",
        {},
        namespaceName);
      return pods.find((item) => {
        const spec = item.spec as
          { readonly serviceAccountName?: string } | undefined;
        const status = item.status as {
          readonly phase?: string;
          readonly conditions?: readonly {
            readonly type?: string;
            readonly status?: string;
          }[];
        } | undefined;
        // Ready, not merely scheduled: a port-forward to a pod whose
        // container is still starting exits instead of retrying.
        return spec?.serviceAccountName === serviceAccountName
          && status?.phase === "Running"
          && (status.conditions ?? []).some(
            (condition) =>
              condition.type === "Ready"
              && condition.status === "True");
      });
    },
    (value) => value !== undefined,
    60_000);
  assert.ok(pod);
  return pod.metadata.name;
}

async function withForwardedPort<T>(
  kubernetes: TestKubernetes,
  namespaceName: string,
  podName: string,
  action: (port: number) => Promise<T>
): Promise<T> {
  let failure: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await forwardOnce(
        kubernetes,
        namespaceName,
        podName,
        action);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

async function forwardOnce<T>(
  kubernetes: TestKubernetes,
  namespaceName: string,
  podName: string,
  action: (port: number) => Promise<T>
): Promise<T> {
  const port = await freeLocalPort();
  const forwarding = kubernetes.startKubectl([
    "port-forward",
    `pod/${podName}`,
    "--namespace",
    namespaceName,
    "--address",
    "127.0.0.1",
    `${String(port)}:8080`
  ]);
  try {
    await waitFor(
      async () => {
        try {
          const probe = await fetch(
            `http://127.0.0.1:${String(port)}/bootstrap`,
            { signal: AbortSignal.timeout(1_000) });
          return probe.status === 200;
        } catch {
          return false;
        }
      },
      (ready) => ready,
      20_000);
    return await action(port);
  } finally {
    await stopProcess(forwarding).catch(() => undefined);
  }
}

async function freeLocalPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("No free local port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  status
} from "@grpc/grpc-js";
import {
  getExecdTestContext
} from "../suite/get-execd-test-context.js";
import {
  getExecdTestSuite
} from "../suite/get-execd-test-suite.js";
import {
  callProductApp
} from "../support/product/call-product-app.js";
import {
  appPath,
  currentProductPod,
  fixture,
  grantedOperation,
  productCheck,
  tenantId,
  waitForProductRecovery,
  workspaceId,
  workspacePath
} from "../support/product/product-fixtures.js";
import {
  waitForExport
} from "../support/telemetry/wait-for-export.js";

const request = {
  operation: grantedOperation,
  resourcePath: appPath(
    workspacePath("app_chat_ws"),
    "topics/general"),
  tenantId,
  workspaceId
};

test("uses cached invocation keys and refreshes unknown keys",
  async () => {
    const context = getExecdTestContext();
    const suite = getExecdTestSuite();
    const chat = fixture("chat_ws");

    // Prime the receiving product's bounded verification-key cache while
    // Identityd is available.
    assert.deepEqual(await productCheck(chat, request), {
      decision: "allow"
    });

    await context.identityd.setMode("unavailable");
    try {
      // A known key remains usable from the unexpired cache. The request
      // reaches Policyd and fails closed when Policyd cannot resolve standing.
      const cached = await productCheck(chat, request);
      assert.equal(cached.decision, undefined);
      assert.equal(cached.error?.stage, "policy");
      assert.equal(cached.error?.code, status.UNAVAILABLE);

      // An unknown key ID forces a refresh. Identityd is unavailable, so the
      // receiving product rejects the invocation before calling Policyd.
      const now = Math.floor(Date.now() / 1_000);
      const unknownKeyInvocation = suite.invocation.signToken(
        JSON.stringify({
          alg: "RS256",
          kid: "key_unknown_product",
          typ: "JWT"
        }),
        JSON.stringify({
          iss: suite.invocation.issuer,
          aud: suite.invocation.audience,
          sub: "user:alice",
          iat: now,
          nbf: now,
          exp: now + 30,
          jti: "invocation-cache-refresh",
          session_id: "session-cache-refresh",
          tenant_id: tenantId,
          workspace_id: workspaceId
        }));
      const refreshed = await callProductApp(
        suite.kubernetes,
        chat.namespace,
        await currentProductPod(chat),
        {
          ...request,
          invocationToken: unknownKeyInvocation
        });
      assert.equal(refreshed.decision, undefined);
      assert.equal(refreshed.error?.stage, "invocation");
      assert.equal(refreshed.error?.code, status.UNAVAILABLE);
    } finally {
      await context.identityd.setMode("available");
      // Restoring a suspended dependency restarts it; the dependent service
      // reconnects explicitly rather than waiting out its channel backoff.
      await suite.policyd.reconnectIdentity();
      await waitForProductRecovery(chat, request);
    }
  });

test("fails closed and records telemetry when its Execd token is unreadable",
  async () => {
    const suite = getExecdTestSuite();
    const chat = fixture("chat_ws");
    const tokenPath = await resolvePolicydTokenPath();
    const originalMode = (
      await suite.kubernetes.runNodeCommand([
        "stat",
        "--dereference",
        "--format=%a",
        tokenPath
      ])).stdout.trim();
    assert.match(originalMode, /^[0-7]{3,4}$/u);
    await suite.collector.clearExports();

    try {
      await suite.kubernetes.runNodeCommand([
        "chmod",
        "000",
        tokenPath
      ]);
      const result = await productCheck(chat, request);
      assert.equal(result.decision, undefined);
      assert.equal(result.error?.stage, "policy");

      await waitForExport(
        suite.collector.tracesPath,
        hasUnavailableExecdSpan);
    } finally {
      await suite.kubernetes.runNodeCommand([
        "chmod",
        originalMode,
        tokenPath
      ]);
    }

    await waitForProductRecovery(chat, request);
  });

async function resolvePolicydTokenPath(): Promise<string> {
  const suite = getExecdTestSuite();
  const document = JSON.parse((await suite.kubernetes.runKubectl([
    "get",
    "pod/policyd-0",
    "--namespace",
    suite.kubernetes.namespace,
    "--output=json"
  ])).stdout) as {
    readonly metadata?: {
      readonly uid?: unknown;
    };
  };
  const uid = document.metadata?.uid;
  if (typeof uid !== "string") {
    assert.fail("Policyd Pod has no Kubernetes UID");
  }
  assert.match(uid, /^[a-f0-9-]{36}$/u);
  return "/var/lib/kubelet/pods/"
    + uid
    + "/volumes/kubernetes.io~projected/workload-token/token";
}

function hasUnavailableExecdSpan(content: string): boolean {
  for (const line of content.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    let document: unknown;
    try {
      document = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (containsUnavailableExecdSpan(document)) {
      return true;
    }
  }
  return false;
}

function containsUnavailableExecdSpan(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsUnavailableExecdSpan);
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Readonly<Record<string, unknown>>;
  if (record.name === "policyd.execd.ResolveWorkloadOperationBinding") {
    const attributes = record.attributes;
    return Array.isArray(attributes)
      && attributes.some((attribute) => {
        if (typeof attribute !== "object" || attribute === null) {
          return false;
        }
        const item = attribute as {
          readonly key?: unknown;
          readonly value?: {
            readonly stringValue?: unknown;
          };
        };
        return item.key === "ctlflow.outcome"
          && item.value?.stringValue === "UNAVAILABLE";
      });
  }
  return Object.values(record).some(containsUnavailableExecdSpan);
}

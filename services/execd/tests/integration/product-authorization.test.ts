import assert from "node:assert/strict";
import { test } from "node:test";
import {
  status
} from "@grpc/grpc-js";
import {
  AccessDecision
} from "../generated/v1/policyd.js";
import {
  getExecdTestContext
} from "../suite/get-execd-test-context.js";
import {
  getExecdTestSuite
} from "../suite/get-execd-test-suite.js";
import {
  createCapabilityGrants
} from "../support/authorization/create-capability-grants.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  createPlacementRequest
} from "../support/placements/create-placement-request.js";
import {
  RealizationPhase
} from "../generated/v1/execd.js";
import {
  getPlacementNamespace
} from "../support/kubernetes/get-placement-namespace.js";
import {
  listOwnedKubernetesObjects
} from "../support/kubernetes/list-owned-kubernetes-objects.js";
import {
  waitFor
} from "../support/wait-for.js";
import {
  createWorkloadRequest
} from "../support/workloads/create-workload-request.js";
import {
  callProductApp,
  findRunningProductPod,
  readProductBootstrap
} from "../support/product/call-product-app.js";
import {
  declareTestPackage
} from "../support/packages/declare-test-app.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";
import {
  accountId,
  appPath,
  assertProductTokenProjection,
  chatPackage,
  currentProductPod,
  declarePlacement,
  declareWorkload,
  getWorkload,
  filesPackage,
  fixture,
  getPolicydClient,
  grantedOperation,
  kernelLexicalOperation,
  mintHostToken,
  packageGrant,
  productCheck,
  realizeProduct,
  rollPackage,
  tenantId,
  tenantPath,
  ungrantedOperation,
  workspaceId,
  workspacePath
} from "../support/product/product-fixtures.js";

// The acceptance boundary: a realized product container makes the complete
// production Identityd and Policyd calls using only its projected bootstrap.
// Host-minted tokens appear below only in explicitly diagnostic tests.

test("realizes the product fixtures with their runtime bootstrap",
  async () => {
    const context = getExecdTestContext();
    const suite = getExecdTestSuite();

    // Parentage is exactly Global -> Tenant -> Workspace|User.
    const root = await declarePlacement(createPlacementRequest({
      placementId: "product_root",
      target: { global: {} }
    }));
    const tenant = await declarePlacement(createPlacementRequest({
      placementId: "product_tenant",
      target: { tenant: { tenantId } },
      parentPlacementId: root.placementId
    }));
    const workspace = await declarePlacement(createPlacementRequest({
      placementId: "product_workspace",
      target: { workspace: { tenantId, workspaceId } },
      parentPlacementId: tenant.placementId
    }));
    const user = await declarePlacement(createPlacementRequest({
      placementId: "product_user",
      target: {
        user: { tenantId, accountPrincipalId: accountId }
      },
      parentPlacementId: tenant.placementId
    }));

    await declareTestPackage(context.pkgd.client, {
      packageId: chatPackage,
      artifact: suite.applicationArtifact,
      serviceOperations: [
        grantedOperation,
        ungrantedOperation,
        kernelLexicalOperation
      ]
    });
    await declareTestPackage(context.pkgd.client, {
      packageId: filesPackage,
      artifact: suite.applicationArtifact,
      serviceOperations: [grantedOperation]
    });
    await declareTestPackage(context.pkgd.client, {
      packageId: rollPackage,
      artifact: suite.applicationArtifact,
      serviceOperations: [grantedOperation]
    });

    await realizeProduct("chat_ws", {
      packageId: chatPackage,
      appId: "app_chat_ws",
      placementId: workspace.placementId,
      scope: { workspace: { tenantId, workspaceId } }
    });
    await realizeProduct("files_ws", {
      packageId: filesPackage,
      appId: "app_files_ws",
      placementId: workspace.placementId,
      scope: { workspace: { tenantId, workspaceId } }
    });
    await realizeProduct("chat_tenant", {
      packageId: chatPackage,
      appId: "app_chat_tenant",
      placementId: tenant.placementId,
      scope: { tenant: { tenantId } }
    });
    await realizeProduct("chat_global", {
      packageId: chatPackage,
      appId: "app_chat_global",
      placementId: root.placementId,
      scope: { global: {} }
    });
    await realizeProduct("chat_user", {
      packageId: chatPackage,
      appId: "app_chat_user",
      placementId: user.placementId,
      scope: {
        user: { tenantId, accountPrincipalId: accountId }
      }
    });
    await realizeProduct("roll_old", {
      packageId: rollPackage,
      appId: "app_roll_old",
      placementId: workspace.placementId,
      scope: { workspace: { tenantId, workspaceId } }
    });
    // A later generation drops the operation; already admitted Workloads keep
    // the snapshot they were admitted with.
    await declareTestPackage(context.pkgd.client, {
      packageId: rollPackage,
      generation: 2n,
      artifact: suite.applicationArtifact,
      serviceOperations: []
    });
    await realizeProduct("roll_new", {
      packageId: rollPackage,
      appId: "app_roll_new",
      placementId: workspace.placementId,
      scope: { workspace: { tenantId, workspaceId } },
      generation: 2n
    });

    await suite.policyd.replacePolicy({
      roles: [],
      grants: [
        ...createCapabilityGrants(),
        packageGrant(chatPackage, grantedOperation, {
          tenantId
        }),
        packageGrant(chatPackage, grantedOperation, {
          tenantId,
          workspaceId
        }),
        packageGrant(chatPackage, kernelLexicalOperation, {
          tenantId
        }),
        packageGrant(rollPackage, grantedOperation, {
          tenantId,
          workspaceId
        })
      ]
    });

    // The projected bootstrap names the admitted App instance.
    const chat = fixture("chat_ws");
    const bootstrap = await readProductBootstrap(
      suite.kubernetes,
      chat.namespace,
      await currentProductPod(chat));
    assert.equal(bootstrap.appId, "app_chat_ws");
    assert.equal(
      bootstrap.tokenFile,
      "/var/run/secrets/ctlflow/token");
    assert.equal(
      bootstrap.jwksPath,
      "/var/run/ctlflow/trust/workload-jwks.json");
    await assertProductTokenProjection(chat);
  });

test("authorizes a product operation from inside the container",
  async () => {
    const chat = fixture("chat_ws");
    const allowed = await productCheck(chat, {
      operation: grantedOperation,
      resourcePath: appPath(workspacePath(chat.appId), "topics/general"),
      tenantId,
      workspaceId
    });
    assert.deepEqual(allowed, { decision: "allow" });

    const denied = await productCheck(chat, {
      operation: ungrantedOperation,
      resourcePath: appPath(workspacePath(chat.appId), "topics/general"),
      tenantId,
      workspaceId
    });
    assert.deepEqual(denied, { decision: "deny" });
  });

test("rejects a tampered invocation inside the container", async () => {
  const suite = getExecdTestSuite();
  const chat = fixture("chat_ws");
  const invocation = suite.invocation.sign({ tenantId, workspaceId });
  const tampered = `${invocation.slice(0, -4)}AAAA`;
  const result = await callProductApp(
    suite.kubernetes,
    chat.namespace,
    await currentProductPod(chat),
    {
      operation: grantedOperation,
      resourcePath: appPath(workspacePath(chat.appId), "topics/general"),
      tenantId,
      workspaceId,
      invocationToken: tampered
    });
  assert.equal(result.decision, undefined);
  assert.equal(result.error?.stage, "invocation");
});

test("validates the complete invocation contract inside the container",
  async () => {
    const suite = getExecdTestSuite();
    const chat = fixture("chat_ws");
    const target = {
      operation: grantedOperation,
      resourcePath: appPath(workspacePath(chat.appId), "topics/general"),
      tenantId,
      workspaceId
    };
    const now = Math.floor(Date.now() / 1_000);
    const payload: Readonly<Record<string, unknown>> = {
      iss: suite.invocation.issuer,
      aud: suite.invocation.audience,
      sub: "user:alice",
      iat: now,
      nbf: now,
      exp: now + 30,
      jti: "receiver-validation",
      session_id: "session-validation",
      tenant_id: tenantId,
      workspace_id: workspaceId
    };
    const invoke = async (invocationToken: string) =>
      await callProductApp(
        suite.kubernetes,
        chat.namespace,
        await currentProductPod(chat),
        { ...target, invocationToken });

    // A colon inside a string value is not a member separator. This valid
    // extension proves the strict scanner does not reject ordinary JSON.
    assert.deepEqual(
      await invoke(suite.invocation.signPayload(JSON.stringify({
        ...payload,
        note: "a:value:with:colons"
      }))),
      { decision: "allow" });

    // A valid virtual Actor is accepted by the receiver and reaches Policyd.
    // This fixture has no authority for that Actor, so the terminal outcome is
    // a policy-stage rejection rather than a local invocation-stage rejection.
    const virtualActor = await invoke(
      suite.invocation.signPayload(JSON.stringify({
        ...payload,
        session_id: undefined,
        run_id: "run-validation",
        act: { sub: "agent:reviewer" }
      })));
    assert.notEqual(virtualActor.error?.stage, "invocation");

    let nested: unknown = "leaf";
    for (let depth = 0; depth < 17; depth++) {
      nested = { value: nested };
    }
    const duplicateSubject = JSON.stringify(payload).replace(
      '"sub":"user:alice"',
      '"sub":"user:alice","\\u0073ub":"user:mallory"');
    const invalidTokens = [
      {
        name: "duplicate decoded member",
        token: suite.invocation.signPayload(duplicateSubject)
      },
      {
        name: "critical header",
        token: suite.invocation.signToken(
          JSON.stringify({
            alg: "RS256",
            kid: suite.invocation.verificationKey.keyId,
            crit: ["custom"]
          }),
          JSON.stringify(payload))
      },
      {
        name: "Actor on a Session",
        token: suite.invocation.signPayload(JSON.stringify({
          ...payload,
          act: { sub: "agent:reviewer" }
        }))
      },
      {
        name: "service Session subject",
        token: suite.invocation.signPayload(JSON.stringify({
          ...payload,
          sub: "service:chat"
        }))
      },
      {
        name: "forbidden authority claim",
        token: suite.invocation.signPayload(JSON.stringify({
          ...payload,
          grants: ["messages.post"]
        }))
      },
      {
        name: "forbidden capability claim",
        token: suite.invocation.signPayload(JSON.stringify({
          ...payload,
          capabilities: ["messages.post"]
        }))
      },
      {
        name: "forbidden Kubernetes identity claim",
        token: suite.invocation.signPayload(JSON.stringify({
          ...payload,
          "kubernetes.io/serviceaccount/namespace": "foreign"
        }))
      },
      {
        name: "non-canonical token ID",
        token: suite.invocation.signPayload(JSON.stringify({
          ...payload,
          jti: "Invalid"
        }))
      },
      {
        name: "fractional time",
        token: suite.invocation.signPayload(JSON.stringify({
          ...payload,
          iat: now + 0.5
        }))
      },
      {
        name: "missing not-before time",
        token: suite.invocation.signPayload(JSON.stringify({
          ...payload,
          nbf: undefined
        }))
      },
      {
        name: "excessive JSON depth",
        token: suite.invocation.signPayload(JSON.stringify({
          ...payload,
          extension: nested
        }))
      },
      {
        name: "oversized token",
        token: suite.invocation.signPayload(JSON.stringify({
          ...payload,
          extension: "x".repeat(17_000)
        }))
      }
    ] as const;

    for (const invalid of invalidTokens) {
      const result = await invoke(invalid.token);
      assert.equal(result.decision, undefined, invalid.name);
      assert.equal(result.error?.stage, "invocation", invalid.name);
    }
  });

test("isolates the same token across Packages", async () => {
  // example.files declares the same lexical token; only example.chat holds the
  // grant, so the identical request from the files App instance is denied.
  const files = fixture("files_ws");
  const result = await productCheck(files, {
    operation: grantedOperation,
    resourcePath: appPath(workspacePath(files.appId), "topics/general"),
    tenantId,
    workspaceId
  });
  assert.deepEqual(result, { decision: "deny" });
});

test("keeps lexically kernel tokens in the package namespace", async () => {
  // `tenants.read` from a product workload is the package operation
  // (package, example.chat, tenants.read), never the kernel one.
  const chat = fixture("chat_tenant");
  const allowed = await productCheck(chat, {
    operation: kernelLexicalOperation,
    resourcePath: tenantPath(chat.appId),
    tenantId
  });
  assert.deepEqual(allowed, { decision: "allow" });

  // A kernel token the package never declared is outside the snapshot.
  const undeclared = await productCheck(chat, {
    operation: "workspaces.read",
    resourcePath: tenantPath(chat.appId),
    tenantId
  });
  assert.equal(undeclared.error?.code, status.PERMISSION_DENIED);
});

test("host-minted diagnostic token replicates the container decision",
  async () => {
    // Diagnostic only: a host-minted pod-bound token for the same retained
    // ServiceAccount reaches the same ALLOW. The production evidence is the
    // in-container flow above.
    const chat = fixture("chat_ws");
    const token = await mintHostToken(chat);
    const suite = getExecdTestSuite();
    const invocation = suite.invocation.sign({ tenantId, workspaceId });
    const client = await getPolicydClient();
    const response = await callUnary<
      import("../generated/v1/policyd.js").CheckAccessResponse
    >((done) => client.checkAccess(
      {
        operation: grantedOperation,
        resourcePath: appPath(workspacePath(chat.appId), "topics/general"),
        tenantId,
        workspaceId
      },
      workloadMetadata(token, invocation),
      done));
    assert.equal(
      response.decision,
      AccessDecision.ACCESS_DECISION_ALLOW);
  });

test("authorizes a product operation from inside a finite Run Job",
  async () => {
    // The Run Job path receives the same product runtime bootstrap as a
    // continuous Deployment, and its container makes the same production
    // Identityd and Policyd calls.
    const context = getExecdTestContext();
    const suite = getExecdTestSuite();
    await callUnary((done) => context.pkgd.client.createApp({
      appId: "app_chat_run",
      scope: { workspace: { tenantId, workspaceId } },
      placementId: "product_workspace",
      packageId: chatPackage,
      desiredPackageGeneration: 1n
    }, done));
    const workload = await declareWorkload(createWorkloadRequest({
      workloadId: "wld_chat_run",
      placementId: "product_workspace",
      appId: "app_chat_run",
      mode: "finite",
      componentId: "service",
      actorPrincipalId: accountId,
      runDurationSeconds: 300n
    }));
    await waitFor(
      async () => await getWorkload(workload.workloadId),
      (value) =>
        value.realization?.phase
          === RealizationPhase.REALIZATION_PHASE_READY,
      60_000);
    await callUnary((done) => context.client.createRun({
      runId: "run_chat_product",
      workloadId: workload.workloadId
    }, done));

    const namespace = await getPlacementNamespace(
      suite.kubernetes,
      "product_workspace");
    const accounts = await waitFor(
      async () => await listOwnedKubernetesObjects(
        suite.kubernetes,
        "serviceaccounts",
        {
          "execution.ctlflow.io/owner-service": "execd",
          "execution.ctlflow.io/workload-id": workload.workloadId
        },
        namespace),
      (value) => value.length === 1,
      60_000);
    const pod = await findRunningProductPod(
      suite.kubernetes,
      namespace,
      accounts[0]!.metadata.name);
    const bootstrap = await readProductBootstrap(
      suite.kubernetes,
      namespace,
      pod);
    assert.equal(bootstrap.appId, "app_chat_run");

    // No invocation is supplied: the container uses the one Execd obtained
    // from Identityd and projected into the Job, so this exercises the real
    // Execd -> Identityd -> Job invocation path.
    assert.deepEqual(
      await callProductApp(suite.kubernetes, namespace, pod, {
        operation: grantedOperation,
        resourcePath:
          `/tenants/${tenantId}/workspaces/${workspaceId}`
          + "/apps/app_chat_run/topics/general",
        tenantId,
        workspaceId
      }),
      { decision: "allow" });
  });

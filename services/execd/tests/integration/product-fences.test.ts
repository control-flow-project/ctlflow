import assert from "node:assert/strict";
import { test } from "node:test";
import {
  status
} from "@grpc/grpc-js";
import {
  DesiredState,
  RealizationPhase,
  type ResolveWorkloadOperationBindingResponse
} from "../generated/v1/execd.js";
import {
  getExecdTestContext
} from "../suite/get-execd-test-context.js";
import {
  getExecdTestSuite
} from "../suite/get-execd-test-suite.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  findSpansForTrace
} from "../support/telemetry/find-spans-for-trace.js";
import {
  waitForExport
} from "../support/telemetry/wait-for-export.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";
import {
  createWorkloadRequest
} from "../support/workloads/create-workload-request.js";
import {
  accountId,
  accountPath,
  appPath,
  assertHostDecision,
  chatPackage,
  declareWorkload,
  fixture,
  getPlacement,
  getWorkload,
  grantedOperation,
  productCheck,
  resumePlacement,
  suspendPlacement,
  tenantId,
  tenantPath,
  waitForBindingSubject,
  workspaceId,
  workspacePath
} from "../support/product/product-fixtures.js";
import {
  waitFor
} from "../support/wait-for.js";

// Placement containment, App anchoring, generation pinning, lifecycle
// concealment, and the resolver admission boundary for product operations.

test("fences every Placement level from inside the containers", async () => {
  const globalFixture = fixture("chat_global");
  const tenantFixture = fixture("chat_tenant");
  const workspaceFixture = fixture("chat_ws");
  const userFixture = fixture("chat_user");

  // Global placement: no narrower containment; a concrete Tenant invocation
  // and App path decide as policy allows.
  assert.deepEqual(
    await productCheck(globalFixture, {
      operation: grantedOperation,
      resourcePath: tenantPath(globalFixture.appId),
      tenantId
    }),
    { decision: "allow" });

  // Tenant placement: the exact Tenant and a descendant Workspace.
  assert.deepEqual(
    await productCheck(tenantFixture, {
      operation: grantedOperation,
      resourcePath: tenantPath(tenantFixture.appId),
      tenantId
    }),
    { decision: "allow" });
  assert.deepEqual(
    await productCheck(tenantFixture, {
      operation: grantedOperation,
      resourcePath: appPath(
        workspacePath(tenantFixture.appId),
        "topics/general"),
      tenantId,
      workspaceId
    }),
    { decision: "allow" });
  assert.equal(
    (await productCheck(tenantFixture, {
      operation: grantedOperation,
      resourcePath: `/tenants/tenant-b/apps/${tenantFixture.appId}`,
      tenantId: "tenant-b"
    })).error?.code,
    status.NOT_FOUND);

  // Workspace placement: that exact Tenant and Workspace only.
  assert.equal(
    (await productCheck(workspaceFixture, {
      operation: grantedOperation,
      resourcePath: tenantPath(workspaceFixture.appId),
      tenantId
    })).error?.code,
    status.NOT_FOUND);
  assert.equal(
    (await productCheck(workspaceFixture, {
      operation: grantedOperation,
      resourcePath:
        `/tenants/${tenantId}/workspaces/workspace-b`
        + `/apps/${workspaceFixture.appId}`,
      tenantId,
      workspaceId: "workspace-b"
    })).error?.code,
    status.NOT_FOUND);

  // User placement: the exact account-scoped App path only. A Tenant-root
  // path is rejected even though the invocation subject matches, and a
  // sibling account or Workspace target never passes.
  assert.deepEqual(
    await productCheck(userFixture, {
      operation: grantedOperation,
      resourcePath: accountPath(accountId, userFixture.appId),
      tenantId
    }),
    { decision: "allow" });
  assert.equal(
    (await productCheck(userFixture, {
      operation: grantedOperation,
      resourcePath: tenantPath(userFixture.appId),
      tenantId
    })).error?.code,
    status.NOT_FOUND);
  assert.equal(
    (await productCheck(userFixture, {
      operation: grantedOperation,
      resourcePath: accountPath("user:bob", userFixture.appId),
      tenantId
    })).error?.code,
    status.NOT_FOUND);
  assert.equal(
    (await productCheck(userFixture, {
      operation: grantedOperation,
      resourcePath: appPath(
        workspacePath(userFixture.appId),
        "topics/general"),
      tenantId,
      workspaceId
    })).error?.code,
    status.NOT_FOUND);
});

test("conceals an out-of-Placement request before validating its path",
  async () => {
    // The regression this guards: containment must be decided from the
    // target and invocation alone. A request outside the Placement whose
    // path is also wrong must still answer concealed NOT_FOUND, never the
    // INVALID_ARGUMENT that path validation would produce.
    const workspaceFixture = fixture("chat_ws");
    for (const resourcePath of [
      // Not a canonical ResourcePath at all. Parsing this before containment
      // produces INVALID_ARGUMENT and exposes path-validation detail.
      "not-a-resource-path",
      // Foreign App inside a sibling Workspace.
      `/tenants/${tenantId}/workspaces/workspace-b/apps/app_files_ws`,
      // Structurally malformed trailing segment.
      `/tenants/${tenantId}/workspaces/workspace-b/apps/`
        + `${workspaceFixture.appId}/UPPER`,
      // Scope that does not match the target at all.
      `/tenants/${tenantId}/apps/${workspaceFixture.appId}`
    ]) {
      const result = await productCheck(workspaceFixture, {
        operation: grantedOperation,
        resourcePath,
        tenantId,
        workspaceId: "workspace-b"
      });
      assert.equal(
        result.error?.code,
        status.NOT_FOUND,
        resourcePath);
    }
  });

test("anchors paths to the admitted App instance", async () => {
  const chat = fixture("chat_ws");
  const files = fixture("files_ws");
  const result = await productCheck(chat, {
    operation: grantedOperation,
    resourcePath: appPath(workspacePath(files.appId), "topics/general"),
    tenantId,
    workspaceId
  });
  assert.equal(result.error?.code, status.INVALID_ARGUMENT);
});

test("pins each Workload to its admitted generation snapshot", async () => {
  const oldGeneration = fixture("roll_old");
  const newGeneration = fixture("roll_new");
  assert.deepEqual(
    await productCheck(oldGeneration, {
      operation: grantedOperation,
      resourcePath: appPath(
        workspacePath(oldGeneration.appId),
        "items/1"),
      tenantId,
      workspaceId
    }),
    { decision: "allow" });
  const dropped = await productCheck(newGeneration, {
    operation: grantedOperation,
    resourcePath: appPath(
      workspacePath(newGeneration.appId),
      "items/1"),
    tenantId,
    workspaceId
  });
  assert.equal(dropped.error?.code, status.PERMISSION_DENIED);
});

test("denies deactivated Workloads and ancestors on the next request",
  async () => {
    // Deactivation authority lives in Execd's records, so this is proven at
    // the resolver seam with a host-minted diagnostic token: suspension and
    // ancestor suspension conceal the binding immediately, and no pod is
    // required because admission, not realization, grants authority.
    const request = createWorkloadRequest({
      workloadId: "product_lifecycle",
      placementId: "product_workspace",
      appId: "app_chat_ws",
      mode: "continuous"
    });
    const declared = await declareWorkload(request);
    const subject = await waitForBindingSubject("product_lifecycle");
    await assertHostDecision(subject, status.OK);

    const suspended = await declareWorkload({
      ...request,
      expectedRevision: declared.revision,
      declaration: {
        ...request.declaration!,
        desiredState: DesiredState.DESIRED_STATE_SUSPENDED
      }
    });
    await assertHostDecision(subject, status.PERMISSION_DENIED);

    const resumed = await declareWorkload({
      ...request,
      expectedRevision: suspended.revision
    });
    await assertHostDecision(subject, status.OK);

    // An inactive Placement ancestor conceals every descendant binding.
    const workspacePlacement = await getPlacement("product_workspace");
    await suspendPlacement(workspacePlacement);
    try {
      await assertHostDecision(subject, status.PERMISSION_DENIED);
    } finally {
      await resumePlacement("product_workspace");
    }
    await assertHostDecision(subject, status.OK);

    await declareWorkload({
      ...request,
      expectedRevision: resumed.revision,
      declaration: {
        ...request.declaration!,
        desiredState: DesiredState.DESIRED_STATE_RETIRED
      }
    });
    await assertHostDecision(subject, status.PERMISSION_DENIED);
  });

test("admits only Policyd to the resolver", async () => {
  const context = getExecdTestContext();
  const suite = getExecdTestSuite();
  const chat = fixture("chat_ws");
  const request = {
    serviceAccountSubject: chat.subject,
    operation: grantedOperation
  };

  const invocation = suite.invocation.sign({ tenantId, workspaceId });
  await assert.rejects(
    callUnary((done) => context.capabilityClient
      .resolveWorkloadOperationBinding(
        request,
        workloadMetadata(
          context.capabilityWorkload.callerToken,
          invocation),
        done)),
    matchGrpcStatus(status.PERMISSION_DENIED));
  await assert.rejects(
    callUnary((done) => context.client
      .resolveWorkloadOperationBinding(request, done)),
    matchGrpcStatus(status.UNAUTHENTICATED));

  // Policyd authenticates as an autonomous kernel workload: its bare workload
  // token resolves the binding, and an invocation token is rejected.
  const policyd = await suite.kubernetes.createWorkloadCredentials("policyd");
  const traceId = "fedcba9876543210fedcba9876543210";
  const resolverMetadata = workloadMetadata(policyd.callerToken);
  resolverMetadata.set(
    "traceparent",
    `00-${traceId}-0123456789abcdef-01`);
  const binding = await callUnary<ResolveWorkloadOperationBindingResponse>(
    (done) => context.capabilityClient.resolveWorkloadOperationBinding(
      request,
      resolverMetadata,
      done));
  assert.equal(binding.appId, chat.appId);
  assert.equal(binding.packageId, chatPackage);
  assert.deepEqual(
    binding.effectivePlacementTarget?.workspace,
    { tenantId, workspaceId });
  await waitForExport(
    suite.collector.tracesPath,
    (value) => {
      const spans = findSpansForTrace(value, traceId);
      const server = spans.find((span) =>
        span.name === "execd.ResolveWorkloadOperationBinding");
      const database = spans.find((span) =>
        span.name
          === "execd.db.resolve_workload_operation_binding");
      return typeof server?.spanId === "string"
        && database?.parentSpanId === server.spanId;
    });
  await assert.rejects(
    callUnary((done) => context.capabilityClient
      .resolveWorkloadOperationBinding(
        request,
        workloadMetadata(policyd.callerToken, invocation),
        done)),
    matchGrpcStatus(status.UNAUTHENTICATED));

  await assert.rejects(
    callUnary((done) => context.capabilityClient
      .resolveWorkloadOperationBinding(
        {
          // Well-formed derived subject that names no Workload.
          serviceAccountSubject:
            "system:serviceaccount:"
            + `plc-${"0".repeat(32)}:wld-${"0".repeat(32)}`,
          operation: grantedOperation
        },
        workloadMetadata(policyd.callerToken),
        done)),
    matchGrpcStatus(status.NOT_FOUND));
});

test("rejects malformed resolver selectors as invalid arguments", async () => {
  // Policyd derives the subject from a token it validated, so a malformed
  // selector is a broken caller rather than an unknown Workload: it is an
  // invalid request, never a concealed absence.
  const context = getExecdTestContext();
  const suite = getExecdTestSuite();
  const policyd = await suite.kubernetes.createWorkloadCredentials("policyd");
  const chat = fixture("chat_ws");
  for (const request of [
    { serviceAccountSubject: "", operation: grantedOperation },
    {
      serviceAccountSubject: "user:alice",
      operation: grantedOperation
    },
    {
      serviceAccountSubject:
        "system:serviceaccount:default:some-account",
      operation: grantedOperation
    },
    {
      // Right prefixes, wrong token shape: never derived by Execd.
      serviceAccountSubject:
        "system:serviceaccount:plc-unknown:wld-unknown",
      operation: grantedOperation
    },
    {
      serviceAccountSubject:
        "system:serviceaccount:"
        + `plc-${"g".repeat(32)}:wld-${"0".repeat(32)}`,
      operation: grantedOperation
    },
    { serviceAccountSubject: chat.subject, operation: "" },
    { serviceAccountSubject: chat.subject, operation: "nodot" },
    {
      serviceAccountSubject: chat.subject,
      operation: "Messages.post"
    },
    {
      serviceAccountSubject: chat.subject,
      operation: "messages.post.extra"
    }
  ]) {
    await assert.rejects(
      callUnary((done) => context.capabilityClient
        .resolveWorkloadOperationBinding(
          request,
          workloadMetadata(policyd.callerToken),
          done)),
      matchGrpcStatus(status.INVALID_ARGUMENT),
      JSON.stringify(request));
  }
});

test("keeps a Workload's admitted authority fixed for its identity",
  async () => {
    // The derived ServiceAccount subject is stable for a Workload ID, so its
    // authority must be too. Moving the App to a later generation does not
    // change that Workload's retained Package snapshot. Lifecycle mutations
    // remain possible, while adopting the generation requires a new ID.
    const context = getExecdTestContext();
    const upgraded = fixture("roll_old");
    const app = await callUnary<{ readonly revision: bigint }>((done) =>
      context.pkgd.client.setAppPackageGeneration(
        {
          appId: upgraded.appId,
          expectedRevision: 1n,
          desiredPackageGeneration: 2n
        },
        done));
    assert.ok(app.revision > 1n);
    const current = await getWorkload("wld_roll_old");
    const request = createWorkloadRequest({
      workloadId: current.workloadId,
      placementId: current.placementId,
      appId: upgraded.appId,
      mode: "continuous",
      resources: {
        cpuMillis: 25,
        memoryBytes: 32n * 1_024n * 1_024n
      }
    });
    const suspended = await declareWorkload({
      ...request,
      expectedRevision: current.revision,
      declaration: {
        ...request.declaration!,
        desiredState: DesiredState.DESIRED_STATE_SUSPENDED
      }
    });
    await waitFor(
      async () => await getWorkload(current.workloadId),
      (value) => value.realization?.phase
        === RealizationPhase.REALIZATION_PHASE_SUSPENDED,
      60_000);
    const resumed = await declareWorkload({
      ...request,
      expectedRevision: suspended.revision
    });
    const retained = await waitFor(
      async () => await getWorkload(current.workloadId),
      (value) => value.revision === resumed.revision
        && value.realization?.phase
          === RealizationPhase.REALIZATION_PHASE_READY,
      60_000);
    assert.equal(
      retained.admittedPackageComponent?.packageGeneration,
      1n);

    // The already admitted Workload keeps the authority it was admitted with.
    assert.deepEqual(
      await productCheck(upgraded, {
        operation: grantedOperation,
        resourcePath: appPath(
          workspacePath(upgraded.appId),
          "items/1"),
        tenantId,
        workspaceId
      }),
      { decision: "allow" });
  });

test("fails closed when the Execd dependency answer is corrupt", async () => {
  // A dependency that cannot answer correctly must never produce ALLOW. The
  // corruption is applied to Execd's own retained state, so the failure
  // travels the production path: real Execd, real private TLS, real Policyd,
  // and the real in-container product call.
  const context = getExecdTestContext();
  const chat = fixture("chat_ws");
  const request = {
    operation: grantedOperation,
    resourcePath: appPath(workspacePath(chat.appId), "topics/general"),
    tenantId,
    workspaceId
  };
  assert.deepEqual(
    await productCheck(chat, request),
    { decision: "allow" });

  const workloadId = "wld_chat_ws";
  const [retained] = await context.database.connection("workloads")
    .select("app_id")
    .where({ workload_id: workloadId });
  assert.ok(retained);
  await context.database.connection
    .raw("PRAGMA ignore_check_constraints = ON");
  try {
    await context.database.connection("workloads")
      .where({ workload_id: workloadId })
      .update({ app_id: "Corrupt App" });
    // Execd itself reports unreadable retained state as UNAVAILABLE ...
    const suite = getExecdTestSuite();
    const policyd = await suite.kubernetes.createWorkloadCredentials("policyd");
    await assert.rejects(
      callUnary((done) => context.capabilityClient
        .resolveWorkloadOperationBinding(
          {
            serviceAccountSubject: chat.subject,
            operation: grantedOperation
          },
          workloadMetadata(policyd.callerToken),
          done)),
      matchGrpcStatus(status.UNAVAILABLE));

    // ... and the in-container decision fails closed on the same state.
    const corrupted = await productCheck(chat, request);
    assert.equal(corrupted.decision, undefined);
    assert.equal(corrupted.error?.stage, "policy");
    assert.equal(corrupted.error?.code, status.UNAVAILABLE);
  } finally {
    await context.database.connection("workloads")
      .where({ workload_id: workloadId })
      .update({ app_id: retained.app_id });
    await context.database.connection
      .raw("PRAGMA ignore_check_constraints = OFF");
  }

  // Minikube can close the host-only tunnel when the corrupt-state RPC
  // terminates its active stream. Reconnect only that test transport and
  // require both real service endpoints to be healthy before continuing.
  await context.process.reconnect();
  assert.deepEqual(
    await productCheck(chat, request),
    { decision: "allow" });
});

test("fails closed when retained Placement ancestry is truncated", async () => {
  const context = getExecdTestContext();
  const suite = getExecdTestSuite();
  const chat = fixture("chat_ws");
  const request = {
    operation: grantedOperation,
    resourcePath: appPath(workspacePath(chat.appId), "topics/general"),
    tenantId,
    workspaceId
  };
  const placementId = "product_workspace";
  const [retained] = await context.database.connection("placements")
    .select("parent_placement_id")
    .where({ placement_id: placementId });
  assert.ok(retained);

  // Bypass the foreign-key guard only to model unreadable retained state. The
  // production resolver must detect the missing ancestor rather than silently
  // granting authority from a truncated chain.
  await context.database.connection.raw("PRAGMA foreign_keys = OFF");
  try {
    await context.database.connection("placements")
      .where({ placement_id: placementId })
      .update({ parent_placement_id: "missing_product_parent" });
    const policyd = await suite.kubernetes.createWorkloadCredentials("policyd");
    await assert.rejects(
      callUnary((done) => context.capabilityClient
        .resolveWorkloadOperationBinding(
          {
            serviceAccountSubject: chat.subject,
            operation: grantedOperation
          },
          workloadMetadata(policyd.callerToken),
          done)),
      matchGrpcStatus(status.UNAVAILABLE));

    const unresolved = await productCheck(chat, request);
    assert.equal(unresolved.decision, undefined);
    assert.equal(unresolved.error?.stage, "policy");
    assert.equal(unresolved.error?.code, status.UNAVAILABLE);
  } finally {
    await context.database.connection("placements")
      .where({ placement_id: placementId })
      .update({ parent_placement_id: retained.parent_placement_id });
    await context.database.connection.raw("PRAGMA foreign_keys = ON");
  }

  assert.deepEqual(await productCheck(chat, request), { decision: "allow" });
});

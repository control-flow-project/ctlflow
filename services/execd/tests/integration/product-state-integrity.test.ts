import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
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
  appPath,
  fixture,
  grantedOperation,
  productCheck,
  tenantId,
  workspaceId,
  workspacePath
} from "../support/product/product-fixtures.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("fails closed when a retained Workload subject is remapped", async () => {
  const context = getExecdTestContext();
  const suite = getExecdTestSuite();
  const workloadId = "wld_chat_ws";
  const [retained] = await context.database.connection("workloads")
    .select("service_account_subject")
    .where({ workload_id: workloadId });
  assert.ok(retained);
  const remappedSubject =
    "system:serviceaccount:"
    + `plc-${"1".repeat(32)}:wld-${"2".repeat(32)}`;

  await context.database.connection("workloads")
    .where({ workload_id: workloadId })
    .update({ service_account_subject: remappedSubject });
  try {
    const policyd = await suite.kubernetes.createWorkloadCredentials("policyd");
    await assert.rejects(
      callUnary((done) => context.capabilityClient
        .resolveWorkloadOperationBinding(
          {
            serviceAccountSubject: remappedSubject,
            operation: grantedOperation
          },
          workloadMetadata(policyd.callerToken),
          done)),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.database.connection("workloads")
      .where({ workload_id: workloadId })
      .update({
        service_account_subject: retained.service_account_subject
      });
  }
});

test("reports a structurally invalid retained Placement lineage as unavailable",
  async () => {
    const context = getExecdTestContext();
    const suite = getExecdTestSuite();
    const chat = fixture("chat_ws");
    const placementId = "product_workspace";
    const [retained] = await context.database.connection("placements")
      .select("parent_placement_id")
      .where({ placement_id: placementId });
    assert.ok(retained);
    const [parent] = await context.database.connection("placements")
      .select("parent_placement_id")
      .where({ placement_id: retained.parent_placement_id });
    assert.equal(typeof parent?.parent_placement_id, "string");

    // Both rows exist and the foreign key remains valid, but a Workspace may
    // not name Global as its direct parent. This distinguishes structural
    // retained-state corruption from the missing-parent case.
    await context.database.connection("placements")
      .where({ placement_id: placementId })
      .update({ parent_placement_id: parent.parent_placement_id });
    try {
      const policyd =
        await suite.kubernetes.createWorkloadCredentials("policyd");
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

      const result = await productCheck(chat, {
        operation: grantedOperation,
        resourcePath: appPath(
          workspacePath(chat.appId),
          "topics/general"),
        tenantId,
        workspaceId
      });
      assert.equal(result.decision, undefined);
      assert.equal(result.error?.stage, "policy");
      assert.equal(result.error?.code, status.UNAVAILABLE);
    } finally {
      await context.database.connection("placements")
        .where({ placement_id: placementId })
        .update({
          parent_placement_id: retained.parent_placement_id
        });
    }

    assert.deepEqual(
      await productCheck(chat, {
        operation: grantedOperation,
        resourcePath: appPath(
          workspacePath(chat.appId),
          "topics/general"),
        tenantId,
        workspaceId
      }),
      { decision: "allow" });
  });

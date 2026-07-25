import assert from "node:assert/strict";
import {
  LifecycleStepKey,
  LifecycleStepOutcome,
  LifecycleStepState,
  type LifecycleStep,
  type LifecycleTarget
} from "../generated/v1/tenantd.js";
import {
  acknowledgeLifecycleStep
} from "./acknowledge-lifecycle-step.js";
import type {
  TenantdTestContext
} from "./create-tenantd-test-context.js";
import {
  listLifecycleSteps
} from "./list-lifecycle-steps.js";
import { workloadMetadata } from "./workload-metadata.js";

export interface LifecycleOperationReference {
  readonly target: LifecycleTarget;
  readonly operationId: string;
  readonly provisioningGeneration: number;
}

export async function completeLifecycleOperation(
  context: TenantdTestContext,
  reference: LifecycleOperationReference
): Promise<void> {
  for (const [index, owner] of lifecycleOwners(context).entries()) {
    const step = await findLifecycleStep(
      context,
      owner.token,
      owner.key,
      reference);
    const response = await acknowledgeLifecycleStep(
      context.client,
      {
        target: step.target,
        lifecycleOperationId: step.lifecycleOperationId,
        provisioningGeneration: step.provisioningGeneration,
        stepKey: step.stepKey,
        expectedStepRevision: step.stepRevision,
        ownerRevision: BigInt(index + 1),
        outcome: LifecycleStepOutcome.LIFECYCLE_STEP_OUTCOME_COMPLETE,
        idempotencyKey:
          `complete-${reference.operationId}-${String(index + 1)}`
      },
      workloadMetadata(owner.token));
    assert.equal(
      response.stepState,
      LifecycleStepState.LIFECYCLE_STEP_STATE_COMPLETE);
  }
}

async function findLifecycleStep(
  context: TenantdTestContext,
  token: string,
  expectedKey: LifecycleStepKey,
  reference: LifecycleOperationReference
): Promise<LifecycleStep> {
  let pageToken = "";
  do {
    const page = await listLifecycleSteps(
      context.client,
      {
        pageSize: 100,
        pageToken
      },
      workloadMetadata(token));
    const step = page.steps.find((candidate) =>
      candidate.lifecycleOperationId === reference.operationId);
    if (step !== undefined) {
      assert.equal(step.stepKey, expectedKey);
      assert.equal(
        step.provisioningGeneration,
        BigInt(reference.provisioningGeneration));
      assert.equal(
        step.target?.tenant?.tenantId,
        reference.target.tenant?.tenantId);
      assert.equal(
        step.target?.workspace?.tenantId,
        reference.target.workspace?.tenantId);
      assert.equal(
        step.target?.workspace?.workspaceId,
        reference.target.workspace?.workspaceId);
      return step;
    }

    pageToken = page.nextPageToken;
  } while (pageToken !== "");

  throw new Error(
    `Lifecycle step ${reference.operationId} was not delivered`);
}

function lifecycleOwners(
  context: TenantdTestContext
): readonly {
  readonly key: LifecycleStepKey;
  readonly token: string;
}[] {
  return [
    {
      key: LifecycleStepKey.LIFECYCLE_STEP_KEY_IDENTITY,
      token: context.lifecycleOwners.identity.callerToken
    },
    {
      key: LifecycleStepKey.LIFECYCLE_STEP_KEY_CONFIGURATION,
      token: context.lifecycleOwners.configuration.callerToken
    },
    {
      key: LifecycleStepKey.LIFECYCLE_STEP_KEY_EXECUTION,
      token: context.lifecycleOwners.execution.callerToken
    },
    {
      key: LifecycleStepKey.LIFECYCLE_STEP_KEY_PACKAGES,
      token: context.lifecycleOwners.packages.callerToken
    }
  ];
}

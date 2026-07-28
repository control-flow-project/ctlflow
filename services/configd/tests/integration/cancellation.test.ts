import assert from "node:assert/strict";
import {
  setTimeout as delay
} from "node:timers/promises";
import { test } from "node:test";
import {
  Metadata,
  status,
  type ClientUnaryCall,
  type ServiceError
} from "@grpc/grpc-js";
import {
  getConfigdTestContext
} from "../suite/get-configd-test-context.js";
import {
  createConfigurationRequest
} from "../support/configurations/create-configuration-request.js";
import {
  publishConfiguration
} from "../support/configurations/publish-configuration.js";
import {
  provisionProjectionOwners
} from "../support/kubernetes/provision-projection-owners.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  createProjectionRequest
} from "../support/projections/create-projection-request.js";
import {
  createSecretRequest
} from "../support/secrets/create-secret-request.js";
import {
  publishSecret
} from "../support/secrets/publish-secret.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("all five RPCs honor in-flight cancellation", async () => {
  const context = getConfigdTestContext();
  const state = await prepareCancellationState();
  await context.database.connection.raw("BEGIN EXCLUSIVE");
  try {
    for (const start of cancellationCalls(state)) {
      await expectCancellation(start);
    }
  } finally {
    await context.database.connection.raw("ROLLBACK");
  }
});

test("all five RPCs honor in-flight deadlines", async () => {
  const context = getConfigdTestContext();
  const state = await prepareCancellationState("deadline");
  await context.database.connection.raw("BEGIN EXCLUSIVE");
  try {
    for (const start of deadlineCalls(state)) {
      await expectDeadline(start);
    }
  } finally {
    await context.database.connection.raw("ROLLBACK");
  }
});

interface CancellationState {
  readonly configuration:
    ReturnType<typeof createConfigurationRequest>;
  readonly secret: ReturnType<typeof createSecretRequest>;
  readonly applyRequest:
    ReturnType<typeof createProjectionRequest>;
}

async function prepareCancellationState(
  suffix = "cancel"
): Promise<CancellationState> {
  const context = getConfigdTestContext();
  const binding = {
    placementId: `${suffix}_all_placement`,
    consumerId: `${suffix}_all_workload`
  };
  await provisionProjectionOwners(
    context.kubernetes,
    binding.placementId,
    binding.consumerId);
  const configuration = createConfigurationRequest({
    configurationId: `${suffix}_all_configuration`,
    ...binding
  });
  const secret = createSecretRequest({
    secretId: `${suffix}_all_secret`,
    ...binding
  });
  await publishConfiguration(context.client, configuration);
  await publishSecret(context.client, secret);
  return {
    configuration,
    secret,
    applyRequest: createProjectionRequest({
      configuration: {
        configurationId: configuration.configurationId,
        configurationVersionId:
          configuration.configurationVersionId
      }
    }, binding)
  };
}

type StartCall = (
  done: (error: ServiceError | null) => void
) => ClientUnaryCall;

function cancellationCalls(
  state: CancellationState
): readonly StartCall[] {
  const context = getConfigdTestContext();
  const operator = new Metadata();
  return [
    (done) => context.client.publishConfiguration(
      createConfigurationRequest({
        configurationId: "cancel_publish_configuration"
      }),
      operator,
      done),
    (done) => context.client.resolveConfiguration(
      {
        configurationId: state.configuration.configurationId,
        configurationVersionId:
          state.configuration.configurationVersionId,
        binding: state.configuration.binding
      },
      operator,
      done),
    (done) => context.client.publishSecret(
      createSecretRequest({
        secretId: "cancel_publish_secret"
      }),
      operator,
      done),
    (done) => context.client.getSecretMetadata(
      {
        secretId: state.secret.secretId,
        binding: state.secret.binding
      },
      operator,
      done),
    (done) => context.workloadClient.applyProjection(
      state.applyRequest,
      workloadMetadata(context.execdWorkload.callerToken),
      done)
  ];
}

function deadlineCalls(
  state: CancellationState
): readonly StartCall[] {
  const context = getConfigdTestContext();
  const deadline = () => ({ deadline: Date.now() + 200 });
  const operator = new Metadata();
  return [
    (done) => context.client.publishConfiguration(
      createConfigurationRequest({
        configurationId: "deadline_publish_configuration"
      }),
      operator,
      deadline(),
      done),
    (done) => context.client.resolveConfiguration(
      {
        configurationId: state.configuration.configurationId,
        configurationVersionId:
          state.configuration.configurationVersionId,
        binding: state.configuration.binding
      },
      operator,
      deadline(),
      done),
    (done) => context.client.publishSecret(
      createSecretRequest({
        secretId: "deadline_publish_secret"
      }),
      operator,
      deadline(),
      done),
    (done) => context.client.getSecretMetadata(
      {
        secretId: state.secret.secretId,
        binding: state.secret.binding
      },
      operator,
      deadline(),
      done),
    (done) => context.workloadClient.applyProjection(
      state.applyRequest,
      workloadMetadata(context.execdWorkload.callerToken),
      deadline(),
      done)
  ];
}

async function expectCancellation(start: StartCall): Promise<void> {
  let call: ClientUnaryCall | undefined;
  const result = new Promise<never>((_resolve, reject) => {
    call = start((error) => {
      reject(error ?? new Error("Cancelled RPC returned no error"));
    });
    call.on("error", () => undefined);
  });
  await delay(50);
  call?.cancel();
  await assert.rejects(
    result,
    matchGrpcStatus(status.CANCELLED));
}

async function expectDeadline(start: StartCall): Promise<void> {
  const result = new Promise<never>((_resolve, reject) => {
    const call = start((error) => {
      reject(error ?? new Error("Expired RPC returned no error"));
    });
    call.on("error", () => undefined);
  });
  await assert.rejects(
    result,
    matchGrpcStatus(status.DEADLINE_EXCEEDED));
}

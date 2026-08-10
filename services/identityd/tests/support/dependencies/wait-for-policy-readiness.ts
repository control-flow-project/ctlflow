import {
  status
} from "@grpc/grpc-js";
import {
  setTimeout as delay
} from "node:timers/promises";
import type {
  TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import type {
  IdentityServiceClient,
  ListTenantMembersResponse
} from "../../generated/v1/identityd.js";
import {
  callUnary
} from "../call-unary.js";
import type {
  InvocationAuthority
} from "../invocation-authority.js";
import {
  workloadMetadata
} from "../workload-metadata.js";

export async function waitForPolicyReadiness(
  client: IdentityServiceClient,
  workload: TestWorkloadCredentials,
  invocation: InvocationAuthority,
  expectAllowed: boolean
): Promise<void> {
  const deadline = Date.now() + 5_000;
  let lastCode: number | undefined;
  while (Date.now() < deadline) {
    try {
      await callUnary<ListTenantMembersResponse>((callback) =>
        client.listTenantMembers(
          { tenantId: "acme", pageSize: 1 },
          workloadMetadata(
            workload.callerToken,
            invocation.sign({ tenantId: "acme" })),
          callback));
      if (expectAllowed) {
        return;
      }
      throw new Error("Policy unexpectedly allowed administration");
    } catch (error) {
      lastCode = readGrpcCode(error);
      if (!expectAllowed && lastCode === status.PERMISSION_DENIED) {
        return;
      }
      if (lastCode !== status.UNAVAILABLE) {
        throw error;
      }
    }
    await delay(50);
  }

  throw new Error(
    `Identityd policy dependency did not become ready; last code: `
    + String(lastCode));
}

function readGrpcCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "number" ? error.code : undefined;
}

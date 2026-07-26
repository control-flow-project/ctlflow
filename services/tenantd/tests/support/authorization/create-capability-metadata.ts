import {
  Metadata
} from "@grpc/grpc-js";
import type {
  TenantdTestContext
} from "../create-tenantd-test-context.js";
import type {
  InvocationTokenOptions
} from "../invocation-authority.js";
import {
  workloadMetadata
} from "../workload-metadata.js";

export function createCapabilityMetadata(
  context: TenantdTestContext,
  options: InvocationTokenOptions
): Metadata {
  return workloadMetadata(
    context.capabilityWorkload.callerToken,
    context.invocation.sign(options));
}

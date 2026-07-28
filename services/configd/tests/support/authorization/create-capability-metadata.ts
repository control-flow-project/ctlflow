import { Metadata } from "@grpc/grpc-js";
import type {
  ConfigdTestContext
} from "../create-configd-test-context.js";
import type {
  InvocationTokenOptions
} from "../invocation-authority.js";
import {
  workloadMetadata
} from "../workload-metadata.js";

export function createCapabilityMetadata(
  context: ConfigdTestContext,
  options: InvocationTokenOptions,
  readOnly = false
): Metadata {
  const caller = readOnly
    ? context.readOnlyCapabilityWorkload
    : context.capabilityWorkload;
  return workloadMetadata(
    caller.callerToken,
    context.invocation.sign(options));
}

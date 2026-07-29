import {
  Metadata
} from "@grpc/grpc-js";
import type {
  InvocationTokenOptions
} from "../invocation-authority.js";
import type {
  ExecdTestContext
} from "../execd-test-context.js";
import {
  workloadMetadata
} from "../workload-metadata.js";
import {
  getExecdTestSuite
} from "../../suite/get-execd-test-suite.js";

export function createCapabilityMetadata(
  context: ExecdTestContext,
  options: InvocationTokenOptions = {}
): Metadata {
  return workloadMetadata(
    context.capabilityWorkload.callerToken,
    getExecdTestSuite().invocation.sign({
      tenantId: "tenant-a",
      subject: "user:alice",
      sessionId: "session-execd-test",
      ...options
    }));
}

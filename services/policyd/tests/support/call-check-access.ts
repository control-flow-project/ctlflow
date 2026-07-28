import type {
  CallOptions,
  Metadata
} from "@grpc/grpc-js";
import type {
  CheckAccessRequest,
  CheckAccessResponse
} from "../generated/v1/policyd.js";
import {
  getPolicydTestContext
} from "../suite/get-policyd-test-context.js";
import {
  callUnary
} from "./call-unary.js";
import type {
  InvocationTokenOptions
} from "./invocation-authority.js";
import type {
  PolicyOwner
} from "./catalog-case.js";
import {
  workloadMetadata
} from "./workload-metadata.js";

export interface CheckAccessOptions {
  readonly owner?: PolicyOwner;
  readonly invocation?: InvocationTokenOptions;
  readonly invocationToken?: string;
  readonly workloadToken?: string;
  readonly metadata?: Metadata;
  readonly call?: CallOptions;
}

export async function callCheckAccess(
  request: CheckAccessRequest,
  options: CheckAccessOptions = {}
): Promise<CheckAccessResponse> {
  const context = getPolicydTestContext();
  const owner = options.owner ?? "tenantd";
  const workload = context.workloads[owner];
  const invocation = options.invocationToken
    ?? context.invocation.sign({
      tenantId: request.tenantId,
      ...(request.workspaceId === undefined
        ? {}
        : { workspaceId: request.workspaceId }),
      ...options.invocation
    });
  const metadata = options.metadata
    ?? workloadMetadata(
      options.workloadToken ?? workload.callerToken,
      invocation);
  return await callUnary((callback) =>
    context.client.checkAccess(
      request,
      metadata,
      options.call ?? {},
      callback));
}

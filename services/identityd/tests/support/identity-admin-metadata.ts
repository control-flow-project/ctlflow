import type {
  Metadata
} from "@grpc/grpc-js";
import type {
  IdentitydTestContext
} from "./create-identityd-test-context.js";
import {
  workloadMetadata
} from "./workload-metadata.js";

export function identityAdminMetadata(
  context: IdentitydTestContext,
  tenantId: string,
  workspaceId?: string
): Metadata {
  return workloadMetadata(
    context.adminWorkload.callerToken,
    context.invocation.sign({
      tenantId,
      ...(workspaceId === undefined ? {} : { workspaceId })
    }));
}

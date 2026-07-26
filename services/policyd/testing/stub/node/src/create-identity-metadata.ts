import type {
  Metadata
} from "@grpc/grpc-js";
import {
  createIdentityWorkloadMetadata
} from "./create-identity-workload-metadata.js";
import type {
  IdentityCallContext
} from "./identity-call-context.js";

export async function createIdentityMetadata(
  workloadTokenPath: string,
  context: IdentityCallContext
): Promise<Metadata> {
  const metadata = await createIdentityWorkloadMetadata(
    workloadTokenPath,
    context.traceparent);
  metadata.add(
    "ctlflow-invocation",
    `Bearer ${context.invocationToken}`);
  return metadata;
}

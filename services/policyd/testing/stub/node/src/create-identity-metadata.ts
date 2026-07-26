import {
  Metadata
} from "@grpc/grpc-js";
import {
  readFile
} from "node:fs/promises";
import type {
  IdentityCallContext
} from "./identity-call-context.js";

export async function createIdentityMetadata(
  workloadTokenPath: string,
  context: IdentityCallContext
): Promise<Metadata> {
  const workloadToken = (
    await readFile(workloadTokenPath, "utf8")
  ).trim();
  if (
    workloadToken.length === 0
    || /\s/u.test(workloadToken)
  ) {
    throw new Error(
      "Outbound workload token is unavailable");
  }

  const metadata = new Metadata();
  metadata.add(
    "authorization",
    `Bearer ${workloadToken}`);
  metadata.add(
    "ctlflow-invocation",
    `Bearer ${context.invocationToken}`);
  if (context.traceparent !== undefined) {
    metadata.add(
      "traceparent",
      context.traceparent);
  }
  return metadata;
}

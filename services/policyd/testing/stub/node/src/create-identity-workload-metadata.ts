import {
  Metadata
} from "@grpc/grpc-js";
import {
  readFile
} from "node:fs/promises";

export async function createIdentityWorkloadMetadata(
  workloadTokenPath: string,
  traceparent?: string
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
  if (traceparent !== undefined) {
    metadata.add("traceparent", traceparent);
  }
  return metadata;
}

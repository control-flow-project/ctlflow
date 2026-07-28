import { Metadata } from "@grpc/grpc-js";

export function workloadMetadata(
  token: string,
  invocationToken?: string
): Metadata {
  const metadata = new Metadata();
  metadata.set("authorization", `Bearer ${token}`);
  if (invocationToken !== undefined) {
    metadata.set("ctlflow-invocation", `Bearer ${invocationToken}`);
  }
  return metadata;
}

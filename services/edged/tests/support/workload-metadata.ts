import {
  Metadata
} from "@grpc/grpc-js";

export function workloadMetadata(token: string): Metadata {
  const metadata = new Metadata();
  metadata.set("authorization", `Bearer ${token}`);
  return metadata;
}

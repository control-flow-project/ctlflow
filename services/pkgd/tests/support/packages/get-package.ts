import {
  Metadata
} from "@grpc/grpc-js";
import type {
  Package,
  PackageServiceClient
} from "../../generated/v1/pkgd.js";
import {
  callUnary
} from "../call-unary.js";

export async function getPackage(
  client: PackageServiceClient,
  packageId: string,
  generation: bigint,
  metadata = new Metadata()
): Promise<Package> {
  return await callUnary<Package>((done) =>
    client.getPackage(
      {
        packageId,
        generation
      },
      metadata,
      done));
}

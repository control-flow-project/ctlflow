import {
  Metadata
} from "@grpc/grpc-js";
import type {
  App,
  PackageServiceClient
} from "../../generated/v1/pkgd.js";
import {
  callUnary
} from "../call-unary.js";

export async function setAppPackageGeneration(
  client: PackageServiceClient,
  appId: string,
  expectedRevision: bigint,
  desiredPackageGeneration: bigint,
  metadata = new Metadata()
): Promise<App> {
  return await callUnary<App>((done) =>
    client.setAppPackageGeneration(
      {
        appId,
        expectedRevision,
        desiredPackageGeneration
      },
      metadata,
      done));
}

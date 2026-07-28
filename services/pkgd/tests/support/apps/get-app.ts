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

export async function getApp(
  client: PackageServiceClient,
  appId: string,
  metadata = new Metadata()
): Promise<App> {
  return await callUnary<App>((done) =>
    client.getApp(
      {
        appId
      },
      metadata,
      done));
}

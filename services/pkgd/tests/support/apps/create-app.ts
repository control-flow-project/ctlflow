import {
  Metadata
} from "@grpc/grpc-js";
import type {
  App,
  CreateAppRequest,
  PackageServiceClient
} from "../../generated/v1/pkgd.js";
import {
  callUnary
} from "../call-unary.js";

export async function createApp(
  client: PackageServiceClient,
  request: CreateAppRequest,
  metadata = new Metadata()
): Promise<App> {
  return await callUnary<App>((done) =>
    client.createApp(request, metadata, done));
}

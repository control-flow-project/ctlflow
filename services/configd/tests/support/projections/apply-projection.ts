import type {
  Metadata
} from "@grpc/grpc-js";
import type {
  ApplyProjectionRequest,
  ConfigurationServiceClient,
  Projection
} from "../../generated/v1/configd.js";
import { callUnary } from "../call-unary.js";

export async function applyProjection(
  client: ConfigurationServiceClient,
  request: ApplyProjectionRequest,
  metadata: Metadata
): Promise<Projection> {
  return await callUnary((done) =>
    client.applyProjection(request, metadata, done));
}

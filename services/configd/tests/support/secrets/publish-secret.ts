import type {
  Metadata
} from "@grpc/grpc-js";
import type {
  ConfigurationServiceClient,
  PublishSecretRequest,
  PublishSecretResponse
} from "../../generated/v1/configd.js";
import { callUnary } from "../call-unary.js";

export async function publishSecret(
  client: ConfigurationServiceClient,
  request: PublishSecretRequest,
  metadata?: Metadata
): Promise<PublishSecretResponse> {
  return await callUnary((done) =>
    metadata === undefined
      ? client.publishSecret(request, done)
      : client.publishSecret(request, metadata, done));
}

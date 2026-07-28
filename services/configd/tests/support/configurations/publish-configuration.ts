import type {
  Metadata
} from "@grpc/grpc-js";
import type {
  ConfigurationServiceClient,
  PublishConfigurationRequest,
  PublishConfigurationResponse
} from "../../generated/v1/configd.js";
import { callUnary } from "../call-unary.js";

export async function publishConfiguration(
  client: ConfigurationServiceClient,
  request: PublishConfigurationRequest,
  metadata?: Metadata
): Promise<PublishConfigurationResponse> {
  return await callUnary((done) =>
    metadata === undefined
      ? client.publishConfiguration(request, done)
      : client.publishConfiguration(request, metadata, done));
}

import type {
  Metadata
} from "@grpc/grpc-js";
import type {
  ConfigurationServiceClient,
  ResolveConfigurationRequest,
  ResolveConfigurationResponse
} from "../../generated/v1/configd.js";
import { callUnary } from "../call-unary.js";

export async function resolveConfiguration(
  client: ConfigurationServiceClient,
  request: ResolveConfigurationRequest,
  metadata?: Metadata
): Promise<ResolveConfigurationResponse> {
  return await callUnary((done) =>
    metadata === undefined
      ? client.resolveConfiguration(request, done)
      : client.resolveConfiguration(request, metadata, done));
}

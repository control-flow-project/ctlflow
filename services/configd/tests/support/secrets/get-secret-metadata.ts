import type {
  Metadata
} from "@grpc/grpc-js";
import type {
  ConfigurationServiceClient,
  GetSecretMetadataRequest,
  GetSecretMetadataResponse
} from "../../generated/v1/configd.js";
import { callUnary } from "../call-unary.js";

export async function getSecretMetadata(
  client: ConfigurationServiceClient,
  request: GetSecretMetadataRequest,
  metadata?: Metadata
): Promise<GetSecretMetadataResponse> {
  return await callUnary((done) =>
    metadata === undefined
      ? client.getSecretMetadata(request, done)
      : client.getSecretMetadata(request, metadata, done));
}

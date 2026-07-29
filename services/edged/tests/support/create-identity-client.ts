import {
  credentials,
  type ClientOptions
} from "@grpc/grpc-js";
import {
  readFile
} from "node:fs/promises";
import type {
  IdentitydProductionService
} from "@ctlflow/identityd/testing/production";
import {
  IdentityServiceClient
} from "../generated/v1/identityd.js";

export async function createIdentityClient(
  identityd: IdentitydProductionService
): Promise<IdentityServiceClient> {
  const authority = await readFile(
    identityd.certificateAuthorityPath);
  return new IdentityServiceClient(
    `127.0.0.1:${String(identityd.grpcPort)}`,
    credentials.createSsl(authority),
    clientOptions(identityd.serverName));
}

function clientOptions(serverName: string): ClientOptions {
  return {
    "grpc.ssl_target_name_override": serverName,
    "grpc.default_authority": serverName
  };
}

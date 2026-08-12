import {
  credentials,
  type ClientOptions
} from "@grpc/grpc-js";
import {
  readFile
} from "node:fs/promises";
import type {
  TenantdProductionService
} from "@ctlflow/tenantd/testing/production";
import {
  TenantServiceClient
} from "../../generated/v1/tenantd.js";

export async function createTenantClient(
  tenantd: TenantdProductionService
): Promise<TenantServiceClient> {
  const certificateAuthority = await readFile(
    tenantd.certificateAuthorityPath);
  return new TenantServiceClient(
    `127.0.0.1:${String(tenantd.grpcPort)}`,
    credentials.createSsl(certificateAuthority),
    clientOptions(tenantd.serverName));
}

function clientOptions(serverName: string): ClientOptions {
  return {
    "grpc.ssl_target_name_override": serverName,
    "grpc.default_authority": serverName
  };
}

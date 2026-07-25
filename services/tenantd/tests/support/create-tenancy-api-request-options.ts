import { readFile } from "node:fs/promises";
import type { RequestOptions } from "node:https";
import type {
  TestKubernetesApiCredentials
} from "@ctlflow/test-mesh";

export interface TenancyApiConnectionRequest {
  readonly method: "DELETE" | "GET" | "POST" | "PUT";
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export async function createTenancyApiRequestOptions(
  credentials: TestKubernetesApiCredentials,
  request: TenancyApiConnectionRequest
): Promise<RequestOptions> {
  const endpoint = new URL(credentials.endpoint);
  const [certificateAuthority, clientCertificate, clientKey] =
    await Promise.all([
      readFile(credentials.certificateAuthorityPath),
      readFile(credentials.clientCertificatePath),
      readFile(credentials.clientKeyPath)
    ]);
  return {
    protocol: endpoint.protocol,
    hostname: endpoint.hostname,
    port: endpoint.port,
    method: request.method,
    path: request.path,
    ca: certificateAuthority,
    cert: clientCertificate,
    key: clientKey,
    headers: request.headers
  };
}

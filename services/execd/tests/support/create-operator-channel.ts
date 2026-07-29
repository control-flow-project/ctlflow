import {
  credentials,
  type ChannelCredentials,
  type ClientOptions
} from "@grpc/grpc-js";
import {
  readFile
} from "node:fs/promises";
import type {
  TestKubernetes
} from "@ctlflow/test-mesh";

export interface OperatorChannel {
  readonly credentials: ChannelCredentials;
  readonly options: ClientOptions;
}

export async function createOperatorChannel(
  kubernetes: TestKubernetes,
  serverCertificateAuthorityPath: string,
  serverName: string
): Promise<OperatorChannel> {
  return {
    credentials: credentials.createSsl(
      await readFile(serverCertificateAuthorityPath),
      await readFile(kubernetes.api.clientKeyPath),
      await readFile(kubernetes.api.clientCertificatePath)),
    options: {
      "grpc.ssl_target_name_override": serverName,
      "grpc.default_authority": serverName
    }
  };
}

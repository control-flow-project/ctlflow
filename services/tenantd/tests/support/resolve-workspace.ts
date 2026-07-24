import type {
  CallOptions,
  ClientUnaryCall,
  Metadata,
  ServiceError
} from "@grpc/grpc-js";
import {
  ResolveWorkspaceRequest,
  type DeepPartial,
  type ResolveWorkspaceResponse,
  type TenantServiceClient
} from "../generated/v1/tenantd.js";

export async function resolveWorkspace(
  client: TenantServiceClient,
  request: DeepPartial<ResolveWorkspaceRequest>,
  metadata: Metadata,
  options?: Partial<CallOptions>
): Promise<ResolveWorkspaceResponse> {
  const normalizedRequest = ResolveWorkspaceRequest.create(request);

  return await new Promise<ResolveWorkspaceResponse>((resolve, reject) => {
    const callback = (
      error: ServiceError | null,
      response: ResolveWorkspaceResponse
    ): void => {
      if (error === null) {
        resolve(response);
      } else {
        reject(error);
      }
    };

    let call: ClientUnaryCall;
    if (options === undefined) {
      call = client.resolveWorkspace(normalizedRequest, metadata, callback);
    } else {
      call = client.resolveWorkspace(
        normalizedRequest,
        metadata,
        options,
        callback);
    }

    call.on("error", () => undefined);
  });
}

import type {
  CallOptions,
  ClientUnaryCall,
  Metadata,
  ServiceError
} from "@grpc/grpc-js";
import {
  GetLifecycleRequest,
  type DeepPartial,
  type GetLifecycleResponse,
  type TenantServiceClient
} from "../generated/v1/tenantd.js";

export async function getLifecycle(
  client: TenantServiceClient,
  request: DeepPartial<GetLifecycleRequest>,
  metadata: Metadata,
  options?: Partial<CallOptions>
): Promise<GetLifecycleResponse> {
  const normalized = GetLifecycleRequest.create(request);
  return await new Promise<GetLifecycleResponse>((resolve, reject) => {
    const callback = (
      error: ServiceError | null,
      response: GetLifecycleResponse
    ): void => {
      if (error === null) {
        resolve(response);
      } else {
        reject(error);
      }
    };

    let call: ClientUnaryCall;
    if (options === undefined) {
      call = client.getLifecycle(normalized, metadata, callback);
    } else {
      call = client.getLifecycle(normalized, metadata, options, callback);
    }
    call.on("error", () => undefined);
  });
}

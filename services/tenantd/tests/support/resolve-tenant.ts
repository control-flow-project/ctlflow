import type {
  CallOptions,
  ClientUnaryCall,
  Metadata,
  ServiceError
} from "@grpc/grpc-js";
import {
  ResolveTenantRequest,
  type DeepPartial,
  type ResolveTenantResponse,
  type TenantServiceClient
} from "../generated/v1/tenantd.js";

export async function resolveTenant(
  client: TenantServiceClient,
  request: DeepPartial<ResolveTenantRequest>,
  metadata: Metadata,
  options?: Partial<CallOptions>
): Promise<ResolveTenantResponse> {
  const normalizedRequest = ResolveTenantRequest.create(request);

  return await new Promise<ResolveTenantResponse>((resolve, reject) => {
    const callback = (
      error: ServiceError | null,
      response: ResolveTenantResponse
    ): void => {
      if (error === null) {
        resolve(response);
      } else {
        reject(error);
      }
    };

    let call: ClientUnaryCall;
    if (options === undefined) {
      call = client.resolveTenant(normalizedRequest, metadata, callback);
    } else {
      call = client.resolveTenant(
        normalizedRequest,
        metadata,
        options,
        callback);
    }

    call.on("error", () => undefined);
  });
}

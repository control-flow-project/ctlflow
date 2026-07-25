import type {
  CallOptions,
  ClientUnaryCall,
  Metadata,
  ServiceError
} from "@grpc/grpc-js";
import {
  ListLifecycleStepsRequest,
  type DeepPartial,
  type ListLifecycleStepsResponse,
  type TenantServiceClient
} from "../generated/v1/tenantd.js";

export async function listLifecycleSteps(
  client: TenantServiceClient,
  request: DeepPartial<ListLifecycleStepsRequest>,
  metadata: Metadata,
  options?: Partial<CallOptions>
): Promise<ListLifecycleStepsResponse> {
  const normalized = ListLifecycleStepsRequest.create(request);
  return await new Promise<ListLifecycleStepsResponse>((resolve, reject) => {
    const callback = (
      error: ServiceError | null,
      response: ListLifecycleStepsResponse
    ): void => {
      if (error === null) {
        resolve(response);
      } else {
        reject(error);
      }
    };

    let call: ClientUnaryCall;
    if (options === undefined) {
      call = client.listLifecycleSteps(normalized, metadata, callback);
    } else {
      call = client.listLifecycleSteps(
        normalized,
        metadata,
        options,
        callback);
    }
    call.on("error", () => undefined);
  });
}

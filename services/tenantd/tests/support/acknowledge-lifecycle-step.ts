import type {
  CallOptions,
  ClientUnaryCall,
  Metadata,
  ServiceError
} from "@grpc/grpc-js";
import {
  AcknowledgeLifecycleStepRequest,
  type AcknowledgeLifecycleStepResponse,
  type DeepPartial,
  type TenantServiceClient
} from "../generated/v1/tenantd.js";

export async function acknowledgeLifecycleStep(
  client: TenantServiceClient,
  request: DeepPartial<AcknowledgeLifecycleStepRequest>,
  metadata: Metadata,
  options?: Partial<CallOptions>
): Promise<AcknowledgeLifecycleStepResponse> {
  const normalized = AcknowledgeLifecycleStepRequest.create(request);
  return await new Promise<AcknowledgeLifecycleStepResponse>(
    (resolve, reject) => {
      const callback = (
        error: ServiceError | null,
        response: AcknowledgeLifecycleStepResponse
      ): void => {
        if (error === null) {
          resolve(response);
        } else {
          reject(error);
        }
      };

      let call: ClientUnaryCall;
      if (options === undefined) {
        call = client.acknowledgeLifecycleStep(
          normalized,
          metadata,
          callback);
      } else {
        call = client.acknowledgeLifecycleStep(
          normalized,
          metadata,
          options,
          callback);
      }
      call.on("error", () => undefined);
    });
}

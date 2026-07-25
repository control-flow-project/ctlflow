import type {
  CallOptions,
  Metadata,
  ServiceError
} from "@grpc/grpc-js";
import {
  WatchLifecycleStepsRequest,
  type DeepPartial,
  type LifecycleStepEvent,
  type TenantServiceClient
} from "../generated/v1/tenantd.js";

export async function readFirstLifecycleStepEvent(
  client: TenantServiceClient,
  request: DeepPartial<WatchLifecycleStepsRequest>,
  metadata: Metadata,
  options?: Partial<CallOptions>
): Promise<LifecycleStepEvent> {
  const normalized = WatchLifecycleStepsRequest.create(request);
  return await new Promise<LifecycleStepEvent>((resolve, reject) => {
    const call = client.watchLifecycleSteps(normalized, metadata, options);
    let settled = false;

    call.once("data", (event: LifecycleStepEvent) => {
      settled = true;
      resolve(event);
      call.cancel();
    });
    call.once("error", (error: ServiceError) => {
      if (!settled) {
        reject(error);
      }
    });
    call.once("end", () => {
      if (!settled) {
        reject(new Error("Lifecycle watch ended before an event"));
      }
    });
  });
}

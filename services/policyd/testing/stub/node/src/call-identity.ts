import {
  status,
  type ClientUnaryCall,
  type ServiceError
} from "@grpc/grpc-js";
import type {
  IdentityCallContext
} from "./identity-call-context.js";
import type {
  PolicyStubState
} from "./policy-stub-state.js";
import {
  waitForIdentityReady
} from "./wait-for-identity-ready.js";

export async function callIdentity<Response>(
  state: PolicyStubState,
  context: IdentityCallContext,
  start: (
    deadline: Date,
    done: (
      error: ServiceError | null,
      response: Response
    ) => void
  ) => ClientUnaryCall
): Promise<Response> {
  const deadline = new Date(
    Date.now() + state.identityCallTimeoutMilliseconds);
  let retryUnavailable = true;
  for (;;) {
    await waitForIdentityReady(
      state,
      context,
      deadline);
    try {
      const attemptDeadline = retryUnavailable
        ? new Date(Math.min(
            deadline.getTime(),
            Date.now()
              + Math.max(
                  1,
                  Math.floor(
                    state.identityCallTimeoutMilliseconds / 4))))
        : deadline;
      return await callOnce(
        context,
        attemptDeadline,
        start);
    } catch (error) {
      if (
        retryUnavailable
        && !context.cancellation.aborted
        && (
          (error as Partial<ServiceError>).code
            === status.UNAVAILABLE
          || (error as Partial<ServiceError>).code
            === status.DEADLINE_EXCEEDED
        )
      ) {
        retryUnavailable = false;
        continue;
      }
      throw error;
    }
  }
}

async function callOnce<Response>(
  context: IdentityCallContext,
  deadline: Date,
  start: (
    deadline: Date,
    done: (
      error: ServiceError | null,
      response: Response
    ) => void
  ) => ClientUnaryCall
): Promise<Response> {
  return await new Promise((resolve, reject) => {
    let call: ClientUnaryCall | undefined;
    const cancel = () => {
      call?.cancel();
    };
    context.cancellation.addEventListener(
      "abort",
      cancel,
      { once: true });
    call = start(deadline, (error, response) => {
      context.cancellation.removeEventListener(
        "abort",
        cancel);
      if (error === null) {
        resolve(response);
      } else {
        reject(error);
      }
    });
    if (context.cancellation.aborted) {
      cancel();
    }
  });
}

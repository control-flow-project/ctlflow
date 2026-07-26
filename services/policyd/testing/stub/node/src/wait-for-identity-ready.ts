import type {
  IdentityCallContext
} from "./identity-call-context.js";
import type {
  PolicyStubState
} from "./policy-stub-state.js";

export async function waitForIdentityReady(
  state: PolicyStubState,
  context: IdentityCallContext,
  deadline: Date
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      context.cancellation.removeEventListener(
        "abort",
        cancel);
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };
    const cancel = () => {
      finish(new Error("Identity call was cancelled"));
    };
    context.cancellation.addEventListener(
      "abort",
      cancel,
      { once: true });
    state.identityClient.waitForReady(
      deadline,
      (error) => {
        finish(error === undefined ? undefined : error);
      });
    if (context.cancellation.aborted) {
      cancel();
    }
  });
}

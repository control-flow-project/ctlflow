import type {
  GetInvocationVerificationKeysResponse
} from "../generated/v1/identityd.js";
import {
  callIdentity
} from "./call-identity.js";
import {
  createIdentityWorkloadMetadata
} from "./create-identity-workload-metadata.js";
import type {
  IdentityCallContext
} from "./identity-call-context.js";
import type {
  PolicyStubState
} from "./policy-stub-state.js";

export async function loadInvocationVerificationKeys(
  state: PolicyStubState,
  context: IdentityCallContext
): Promise<GetInvocationVerificationKeysResponse> {
  const metadata = await createIdentityWorkloadMetadata(
    state.outboundWorkloadTokenPath,
    context.traceparent);
  return await callIdentity(
    state,
    context,
    (deadline, done) =>
      state.identityClient.getInvocationVerificationKeys(
        {},
        metadata,
        { deadline },
        done));
}

import type {
  PolicyStubState
} from "./policy-stub-state.js";

export function reconnectIdentityClient(
  state: PolicyStubState
): void {
  const previous = state.identityClient;
  state.identityClient = state.createIdentityClient();
  previous.close();
}

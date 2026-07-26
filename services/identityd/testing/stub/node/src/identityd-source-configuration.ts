import type {
  InvocationVerificationKeyResponse
} from "./invocation-verification-key.js";
import type {
  PrincipalAuthorizationFacts
} from "./principal-authorization-facts.js";

export interface IdentitydSourceConfiguration {
  readonly callerSubject: string;
  readonly verificationKeys:
    InvocationVerificationKeyResponse;
  readonly principalFacts:
    readonly PrincipalAuthorizationFacts[];
}

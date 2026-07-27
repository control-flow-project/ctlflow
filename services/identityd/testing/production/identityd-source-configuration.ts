import type {
  InvocationVerificationKeyResponse
} from "./invocation-verification-key.js";
import type {
  PrincipalAuthorizationFacts
} from "./principal-authorization-facts.js";
import type {
  ExternalIdentityLink
} from "./external-identity-link.js";

export interface IdentitydSourceConfiguration {
  readonly callerSubject: string;
  readonly verificationKeys: InvocationVerificationKeyResponse;
  readonly principalFacts: readonly PrincipalAuthorizationFacts[];
  readonly externalIdentityLinks?: readonly ExternalIdentityLink[];
}

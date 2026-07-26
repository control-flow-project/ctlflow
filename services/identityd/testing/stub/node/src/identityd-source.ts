import type {
  IdentitydMode
} from "./identityd-mode.js";
import type {
  IdentitydRequestEvidence
} from "./identityd-request-evidence.js";
import type {
  InvocationVerificationKeyResponse
} from "./invocation-verification-key.js";
import type {
  PrincipalAuthorizationFacts
} from "./principal-authorization-facts.js";

export interface IdentitydSource {
  readonly callerSubject: string;
  mode: IdentitydMode;
  verificationKeys: InvocationVerificationKeyResponse;
  principalFacts: readonly PrincipalAuthorizationFacts[];
  readonly requests: IdentitydRequestEvidence[];
}

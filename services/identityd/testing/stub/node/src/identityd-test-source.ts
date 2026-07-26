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

export interface IdentitydTestSource {
  readonly sourceId: string;
  readonly setMode: (mode: IdentitydMode) => Promise<void>;
  readonly setVerificationKeys: (
    response: InvocationVerificationKeyResponse
  ) => Promise<void>;
  readonly setPrincipalFacts: (
    facts: readonly PrincipalAuthorizationFacts[]
  ) => Promise<void>;
  readonly readRequests: () => Promise<
    readonly IdentitydRequestEvidence[]>;
  readonly stop: () => Promise<void>;
}

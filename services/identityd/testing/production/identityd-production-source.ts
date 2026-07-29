import type {
  IdentitydMode
} from "./identityd-mode.js";
import type {
  InvocationVerificationKeyResponse
} from "./invocation-verification-key.js";
import type {
  PrincipalAuthorizationFacts
} from "./principal-authorization-facts.js";

export interface IdentitydProductionSource {
  readonly corruptPrincipalKind: (
    principalId: string,
    kind: "human" | "service"
  ) => Promise<void>;
  readonly expireSession: (
    credential: Uint8Array
  ) => Promise<void>;
  readonly setMode: (mode: IdentitydMode) => Promise<void>;
  readonly setVerificationKeys: (
    response: InvocationVerificationKeyResponse
  ) => Promise<void>;
  readonly setPrincipalFacts: (
    facts: readonly PrincipalAuthorizationFacts[]
  ) => Promise<void>;
  readonly stop: () => Promise<void>;
}

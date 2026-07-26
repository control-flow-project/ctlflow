import type {
  IdentitydMode
} from "./identityd-mode.js";
import type {
  IdentitydRequestEvidence
} from "./identityd-request-evidence.js";
import type {
  InvocationVerificationKeyResponse
} from "./invocation-verification-key.js";

export interface IdentitydTestSource {
  readonly sourceId: string;
  readonly setMode: (mode: IdentitydMode) => Promise<void>;
  readonly setResponse: (
    response: InvocationVerificationKeyResponse
  ) => Promise<void>;
  readonly readRequests: () => Promise<
    readonly IdentitydRequestEvidence[]>;
  readonly stop: () => Promise<void>;
}

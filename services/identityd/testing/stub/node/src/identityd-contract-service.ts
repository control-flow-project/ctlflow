import type {
  IdentitydTestSource
} from "./identityd-test-source.js";
import type {
  InvocationVerificationKeyResponse
} from "./invocation-verification-key.js";

export interface IdentitydContractService {
  readonly endpoint: string;
  readonly certificateAuthorityPath: string;
  readonly serverName: string;
  readonly createSource: (
    callerSubject: string,
    response: InvocationVerificationKeyResponse
  ) => Promise<IdentitydTestSource>;
  readonly stop: () => Promise<void>;
}

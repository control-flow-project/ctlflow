import type {
  PolicySourceConfiguration
} from "./policy-source-configuration.js";
import type {
  PolicyTestSource
} from "./policy-test-source.js";

export interface PolicyContractService {
  readonly endpoint: string;
  readonly certificateAuthorityPath: string;
  readonly serverName: string;
  readonly identityCallerSubject: string;
  readonly createSource: (
    configuration: PolicySourceConfiguration
  ) => Promise<PolicyTestSource>;
  readonly stop: () => Promise<void>;
}

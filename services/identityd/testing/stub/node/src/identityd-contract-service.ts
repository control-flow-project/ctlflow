import type {
  IdentitydTestSource
} from "./identityd-test-source.js";
import type {
  IdentitydSourceConfiguration
} from "./identityd-source-configuration.js";

export interface IdentitydContractService {
  readonly endpoint: string;
  readonly certificateAuthorityPath: string;
  readonly serverName: string;
  readonly createSource: (
    configuration: IdentitydSourceConfiguration
  ) => Promise<IdentitydTestSource>;
  readonly stop: () => Promise<void>;
}

import type {
  IdentitydSourceConfiguration
} from "./identityd-source-configuration.js";
import type {
  IdentitydProductionSource
} from "./identityd-production-source.js";

export interface IdentitydProductionService {
  readonly endpoint: string;
  readonly grpcPort: number;
  readonly certificateAuthorityPath: string;
  readonly serverName: string;
  readonly createSource: (
    configuration: IdentitydSourceConfiguration
  ) => Promise<IdentitydProductionSource>;
  readonly stop: () => Promise<void>;
}

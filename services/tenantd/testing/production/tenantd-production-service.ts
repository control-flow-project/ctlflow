import type {
  TenancySnapshot
} from "./tenancy-snapshot.js";

export interface TenantdProductionService {
  readonly endpoint: string;
  readonly grpcPort: number;
  readonly certificateAuthorityPath: string;
  readonly serverName: string;
  readonly replaceTenancy: (snapshot: TenancySnapshot) => Promise<void>;
  readonly setMode: (mode: "available" | "unavailable") => Promise<void>;
  readonly stop: () => Promise<void>;
}

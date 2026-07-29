import type {
  OriginRequestEvidence
} from "./origin-request-evidence.js";

export interface ControlledOrigin {
  readonly endpoint: string;
  readonly serverName: string;
  readonly certificateAuthorityPath: string;
  readonly clearEvidence: () => Promise<void>;
  readonly readEvidence: () =>
    Promise<readonly OriginRequestEvidence[]>;
  readonly setAvailable: (available: boolean) => Promise<void>;
  readonly stop: () => Promise<void>;
}

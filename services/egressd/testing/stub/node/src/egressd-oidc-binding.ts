import type {
  EgressRequestEvidence
} from "./egress-request-evidence.js";
import type {
  EgressdMode
} from "./egressd-mode.js";

export interface EgressdOidcBinding {
  readonly bindingName: string;
  readonly endpoint: string;
  readonly setMode: (mode: EgressdMode) => Promise<void>;
  readonly clearEvidence: () => Promise<void>;
  readonly readEvidence: () =>
    Promise<readonly EgressRequestEvidence[]>;
  readonly stop: () => Promise<void>;
}

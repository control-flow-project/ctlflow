import type {
  PolicyGrant
} from "./policy-grant.js";
import type {
  PolicyMode
} from "./policy-mode.js";
import type {
  PolicyRequestEvidence
} from "./policy-request-evidence.js";

export interface PolicyTestSource {
  readonly sourceId: string;
  readonly setMode: (
    mode: PolicyMode
  ) => Promise<void>;
  readonly setGrants: (
    grants: readonly PolicyGrant[]
  ) => Promise<void>;
  readonly readRequests: () => Promise<
    readonly PolicyRequestEvidence[]>;
  readonly stop: () => Promise<void>;
}

import type {
  PolicyGrant
} from "./policy-grant.js";
import type {
  PolicyMode
} from "./policy-mode.js";
import type {
  PolicyRequestEvidence
} from "./policy-request-evidence.js";

export interface PolicySource {
  readonly callerSubject: string;
  mode: PolicyMode;
  grants: readonly PolicyGrant[];
  readonly requests: PolicyRequestEvidence[];
}

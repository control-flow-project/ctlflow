import type {
  PolicyRule
} from "./policy-rule.js";
import type {
  PolicySubject
} from "./policy-subject.js";
import type {
  PolicyTarget
} from "./policy-target.js";

export interface PolicyGrant extends PolicyRule {
  readonly target: PolicyTarget;
  readonly subject: PolicySubject;
}

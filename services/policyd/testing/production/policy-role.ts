import type {
  PolicyRule
} from "./policy-rule.js";
import type {
  PolicySubject
} from "./policy-subject.js";
import type {
  PolicyTarget
} from "./policy-target.js";

export interface PolicyRole {
  readonly roleId: string;
  readonly target: PolicyTarget;
  readonly rules: readonly PolicyRule[];
  readonly subjects: readonly PolicySubject[];
}

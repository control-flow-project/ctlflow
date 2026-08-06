import type {
  PolicyRule,
  PolicySubject
} from "@ctlflow/policyd/testing/production";

export interface CapabilityGrant extends Omit<PolicyRule, "owner"> {
  readonly subject: PolicySubject;
}

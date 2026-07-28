import type {
  PolicyRule,
  PolicySubject
} from "@ctlflow/policyd/testing/production";

export interface CapabilityGrant extends PolicyRule {
  readonly subject: PolicySubject;
}

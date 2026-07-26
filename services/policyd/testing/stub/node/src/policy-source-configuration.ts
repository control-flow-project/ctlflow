import type {
  PolicyGrant
} from "./policy-grant.js";

export interface PolicySourceConfiguration {
  readonly callerSubject: string;
  readonly grants: readonly PolicyGrant[];
}

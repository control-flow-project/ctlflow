import type {
  PolicyGrant
} from "./policy-grant.js";
import type {
  PolicyRole
} from "./policy-role.js";

export interface PolicyState {
  readonly roles: readonly PolicyRole[];
  readonly grants: readonly PolicyGrant[];
}

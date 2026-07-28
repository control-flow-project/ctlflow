import type {
  PolicydTestContext
} from "../support/create-policyd-test-context.js";

export const policydTestContextState: {
  current: PolicydTestContext | undefined;
} = {
  current: undefined
};
